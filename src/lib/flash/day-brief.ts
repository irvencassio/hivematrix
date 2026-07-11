/**
 * Day Brief — the operator's day, assembled from what actually shipped.
 *
 * "The system shows up" (2026-07-10 spec): rather than waiting for the
 * operator to ask, HiveMatrix composes two short rituals a day —
 * `composeDayBrief("morning")` and `composeDayBrief("evening")` — from live
 * signal: PIM reads (calendar/reminders), Workflow Inbox task state, and
 * recent voice-origin loop-closures (see loop-closer.ts). Also backs the
 * live-call greeting (`buildVoiceGreeting`), a deterministic, model-free
 * sibling that reuses the same fact-gathering.
 *
 * Pure assembly is separated from I/O the same way `notify()` separates
 * `NotifyDeps` (lib/notify/notify.ts) from its channels: a `DayBriefDeps`
 * bag of injectable fetchers, with `defaultDayBriefDeps` wiring the real
 * implementations directly (same shape as `defaultLoopCloserDeps` in
 * lib/voice/loop-closer.ts). Callers needing custom delivery (e.g. the
 * heartbeat tick's `notify`) inject just that piece; tests fake the lot.
 *
 * Output contract: plain text, <=6 short lines, no markdown — the same text
 * goes to iMessage/notify() and to TTS, so it must read naturally aloud.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { executePimTool as defaultExecutePimTool } from "@/lib/orchestrator/pim-tools";
import { getWorkflowInbox as defaultGetWorkflowInbox, type WorkflowInbox } from "@/lib/workflows/inbox";
import { localChatComplete, type ChatComplete } from "@/lib/models/chat-client";
import { configuredBrainRootDir } from "@/lib/brain/settings";
import { Task } from "@/lib/db";

export type DayBriefKind = "morning" | "evening";

export interface DayBriefTaskRef {
  title: string;
}

export interface VoiceLoopClosure {
  title: string;
  notifiedAt: string;
}

const MAX_LINES = 6;
const ONE_THING_MAX_TOKENS = 120;
const LOOP_CLOSURE_LOOKBACK_MS = 12 * 60 * 60 * 1000; // 12h, per spec
const GREETING_LOOP_CLOSURE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // "most recent … since last voice session" proxy

// ---------------------------------------------------------------------------
// Dependencies — pure assembly is injected; defaults wire the real IO.
// ---------------------------------------------------------------------------

export interface DayBriefDeps {
  /** PIM reads — calendar_today / reminders_list (and calendar_next_within for
   * the greeting), dispatched exactly like the model-facing tool. */
  executePimTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  /** Workflow Inbox — needs review / ready / blocked / attention counts. */
  getWorkflowInbox: () => WorkflowInbox | Promise<WorkflowInbox>;
  /** Voice-origin loop-closures notified at/after `sinceIso`, most-recent first. */
  listVoiceLoopClosures: (sinceIso: string) => Promise<VoiceLoopClosure[]> | VoiceLoopClosure[];
  /** Evening only: tasks that went terminal (with completedAt) at/after `sinceIso`. */
  listCompletedSince: (sinceIso: string) => Promise<DayBriefTaskRef[]> | DayBriefTaskRef[];
  /** Evening only: tasks still open (backlog/in_progress/review). */
  listOpenTasks: () => Promise<DayBriefTaskRef[]> | DayBriefTaskRef[];
  /** Evening only: tasks queued to run later (backlog with a future delayUntil). */
  listQueuedOvernight: () => Promise<DayBriefTaskRef[]> | DayBriefTaskRef[];
  /** Local-model pass for the morning "ONE thing" line. Any failure omits the line. */
  chatComplete: ChatComplete;
  /** GOALS.md persona content, if present — context for the "ONE thing" pass. */
  readGoalsPersona: () => string | null;
  now: () => Date;
}

async function defaultListVoiceLoopClosures(sinceIso: string): Promise<VoiceLoopClosure[]> {
  // output.loopNotifiedAt lives inside a JSON TEXT column (no SQL path into
  // it — see loop-closer.ts's header note on the storage choice), so bound
  // the candidate set by updatedAt (set at the same terminal transition) and
  // filter precisely in JS.
  const rows = await Task.find({ updatedAt: { $gte: sinceIso } }).sort({ updatedAt: -1 }).limit(50);
  return rows
    .filter((t) => {
      const output = (t.output ?? {}) as Record<string, unknown>;
      return output.origin === "voice" && typeof output.loopNotifiedAt === "string" && output.loopNotifiedAt >= sinceIso;
    })
    .map((t) => ({ title: t.title, notifiedAt: (t.output as Record<string, unknown>).loopNotifiedAt as string }))
    .sort((a, b) => (a.notifiedAt < b.notifiedAt ? 1 : -1));
}

async function defaultListCompletedSince(sinceIso: string): Promise<DayBriefTaskRef[]> {
  const rows = await Task.find({
    status: { $in: ["done", "failed", "cancelled"] },
    completedAt: { $gte: sinceIso },
  }).sort({ completedAt: -1 }).limit(20);
  return rows.map((t) => ({ title: t.title }));
}

async function defaultListOpenTasks(): Promise<DayBriefTaskRef[]> {
  const rows = await Task.find({ status: { $in: ["backlog", "in_progress", "review"] } })
    .sort({ updatedAt: -1 })
    .limit(20);
  return rows.map((t) => ({ title: t.title }));
}

async function defaultListQueuedOvernight(): Promise<DayBriefTaskRef[]> {
  const rows = await Task.find({ status: "backlog", delayUntil: { $ne: null, $gt: new Date().toISOString() } })
    .sort({ delayUntil: 1 })
    .limit(20);
  return rows.map((t) => ({ title: t.title }));
}

function defaultReadGoalsPersona(): string | null {
  const root = configuredBrainRootDir();
  if (!root) return null;
  try {
    const path = join(root, "persona", "GOALS.md");
    if (!existsSync(path)) return null;
    const content = readFileSync(path, "utf-8").slice(0, 4000).trim();
    return content || null;
  } catch {
    return null;
  }
}

export const defaultDayBriefDeps: DayBriefDeps = {
  executePimTool: defaultExecutePimTool,
  getWorkflowInbox: defaultGetWorkflowInbox,
  listVoiceLoopClosures: defaultListVoiceLoopClosures,
  listCompletedSince: defaultListCompletedSince,
  listOpenTasks: defaultListOpenTasks,
  listQueuedOvernight: defaultListQueuedOvernight,
  chatComplete: localChatComplete,
  readGoalsPersona: defaultReadGoalsPersona,
  now: () => new Date(),
};

// ---------------------------------------------------------------------------
// Small IO helpers — never throw; a missing/failing fact just drops its line.
// ---------------------------------------------------------------------------

async function safeCall<T>(fn: () => Promise<T> | T, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Pure line-builders — each collapses a raw fact into one short sentence.
// ---------------------------------------------------------------------------

/** Pure: summarize calendar_today's text output into one line. */
export function calendarLine(calendarText: string): string {
  const lines = calendarText.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || /^nothing on the calendar/i.test(lines[0]) || /^could not read/i.test(lines[0])) {
    return "No meetings today.";
  }
  const first = lines[0].split(" — ")[0].trim();
  return lines.length === 1 ? `1 meeting today: ${first}.` : `${lines.length} meetings today, next: ${first}.`;
}

/** Pure: summarize reminders_list's text output into one line. */
export function remindersLine(remindersText: string): string {
  const lines = remindersText.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || /^no open reminders/i.test(lines[0]) || /^could not read/i.test(lines[0])) {
    return "No reminders due.";
  }
  const first = lines[0].replace(/^-\s*/, "").split(" (due")[0].trim();
  return lines.length === 1 ? `1 reminder open: ${first}.` : `${lines.length} reminders open, e.g. ${first}.`;
}

/** Pure: how many Workflow Inbox items are the operator's to act on. */
export function reviewAttentionCount(inbox: WorkflowInbox | null | undefined): number {
  if (!inbox) return 0;
  const c = inbox.counts;
  return c.needs_review + c.changes_requested + c.proposed_actions_ready;
}

/** Pure: "tasks awaiting review/approval" line for the morning brief. */
export function reviewLine(inbox: WorkflowInbox | null | undefined): string {
  const n = reviewAttentionCount(inbox);
  return n === 0 ? "Nothing awaiting your review." : `${n} item${n === 1 ? "" : "s"} awaiting review/approval.`;
}

/** Pure: recent voice loop-closure line, or null when there's nothing to say. */
export function loopClosureLine(closures: VoiceLoopClosure[]): string | null {
  if (closures.length === 0) return null;
  const first = closures[0].title;
  return closures.length === 1
    ? `Closed the loop on: ${first}.`
    : `Closed the loop on ${closures.length}, incl. ${first}.`;
}

/** Pure: what shipped today, for the evening ledger. */
export function completedLine(tasks: DayBriefTaskRef[]): string {
  if (tasks.length === 0) return "Nothing shipped today.";
  const first = tasks[0].title;
  return tasks.length === 1 ? `Shipped: ${first}.` : `Shipped ${tasks.length} today, incl. ${first}.`;
}

/** Pure: what's still open or slipped, for the evening ledger. */
export function openLine(tasks: DayBriefTaskRef[]): string {
  if (tasks.length === 0) return "Nothing open or slipped.";
  const first = tasks[0].title;
  return tasks.length === 1 ? `Still open: ${first}.` : `${tasks.length} still open or slipped, incl. ${first}.`;
}

/** Pure: what's queued to run overnight, for the evening ledger. */
export function queuedLine(tasks: DayBriefTaskRef[]): string {
  if (tasks.length === 0) return "Nothing queued overnight.";
  const first = tasks[0].title;
  return tasks.length === 1 ? `Queued overnight: ${first}.` : `${tasks.length} queued overnight, incl. ${first}.`;
}

/** Pure: build the local-model prompt for the "ONE thing" line. */
export function buildOneThingPrompt(facts: string, goalsPersona: string | null): { system: string; user: string } {
  return {
    system:
      "Name the ONE most important focus for today in a single short, concrete sentence, given the facts below " +
      "(and the operator's goals, if given). No preamble, no markdown, no quotes — just the sentence.",
    user: goalsPersona
      ? `Operator's goals (GOALS.md):\n${goalsPersona}\n\nToday's facts:\n${facts}`
      : `Today's facts:\n${facts}`,
  };
}

async function composeOneThingLine(facts: string, goalsPersona: string | null, chatComplete: ChatComplete): Promise<string | null> {
  const prompt = buildOneThingPrompt(facts, goalsPersona);
  try {
    const reply = await chatComplete(
      [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      { temperature: 0, maxTokens: ONE_THING_MAX_TOKENS },
    );
    const cleaned = reply.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/\s+/g, " ").trim();
    return cleaned ? `ONE thing: ${cleaned}` : null;
  } catch {
    return null; // model failure → omit the line, never fail the whole brief
  }
}

// ---------------------------------------------------------------------------
// composeDayBrief — the primitive.
// ---------------------------------------------------------------------------

/**
 * Assemble the operator's day brief. Pure orchestration over `deps` — every
 * fetch is best-effort (a failing fact drops its line rather than failing the
 * whole brief); the only line that can be entirely omitted by design is the
 * morning "ONE thing" (model failure → omit, per spec).
 */
export async function composeDayBrief(kind: DayBriefKind, deps: DayBriefDeps = defaultDayBriefDeps): Promise<string> {
  const now = deps.now();
  const lines: string[] = [];
  const sinceLoopClosures = new Date(now.getTime() - LOOP_CLOSURE_LOOKBACK_MS).toISOString();

  if (kind === "morning") {
    const [calendarText, remindersText, inbox, closures] = await Promise.all([
      safeCall(() => deps.executePimTool("calendar_today", { limit: 5 }), ""),
      safeCall(() => deps.executePimTool("reminders_list", { limit: 10 }), ""),
      safeCall(() => deps.getWorkflowInbox(), null as WorkflowInbox | null),
      safeCall(() => deps.listVoiceLoopClosures(sinceLoopClosures), [] as VoiceLoopClosure[]),
    ]);

    lines.push(calendarLine(calendarText));
    lines.push(remindersLine(remindersText));
    lines.push(reviewLine(inbox));
    const closureLine = loopClosureLine(closures);
    if (closureLine) lines.push(closureLine);

    const goalsPersona = safeSyncOrNull(deps.readGoalsPersona);
    const oneThing = await composeOneThingLine(lines.join(" "), goalsPersona, deps.chatComplete);
    if (oneThing) lines.push(oneThing);
  } else {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);

    const [completed, open, queued, closures] = await Promise.all([
      safeCall(() => deps.listCompletedSince(midnight.toISOString()), [] as DayBriefTaskRef[]),
      safeCall(() => deps.listOpenTasks(), [] as DayBriefTaskRef[]),
      safeCall(() => deps.listQueuedOvernight(), [] as DayBriefTaskRef[]),
      safeCall(() => deps.listVoiceLoopClosures(sinceLoopClosures), [] as VoiceLoopClosure[]),
    ]);

    lines.push(completedLine(completed));
    lines.push(openLine(open));
    lines.push(queuedLine(queued));
    const closureLine = loopClosureLine(closures);
    if (closureLine) lines.push(closureLine);
  }

  return lines.slice(0, MAX_LINES).join("\n");
}

function safeSyncOrNull(fn: () => string | null): string | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// buildVoiceGreeting — Surface 2 (contextual live-call greeting). Assembly
// only, no model call, deterministic fallback on ANY error/slowness so the
// live-call latency budget (<1.5s) is never at the mercy of a slow AppleScript
// read (Calendar.app cold-launch). Surface 3 ("while you were away") is just
// the loop-closure fact below — no extra work per spec.
// ---------------------------------------------------------------------------

export const GREETING_FALLBACK = "Hi — I'm ready.";
const GREETING_DEADLINE_MS = 1200; // budget: <1.5s total, minus HTTP/JSON overhead

/** Pure: time-of-day salutation from a local Date. */
export function timeSalutation(now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return "Hi";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Pure: assemble the greeting sentence from up to 2 highest-signal facts,
 * in priority order (next meeting > review/approval count > loop-closure). */
export function buildGreetingText(now: Date, nextMeetingTitle: string, reviewCount: number, mostRecentClosure: VoiceLoopClosure | null): string {
  const facts: string[] = [];
  if (nextMeetingTitle) facts.push(`your next meeting is ${nextMeetingTitle}`);
  if (reviewCount > 0) facts.push(`${reviewCount} item${reviewCount === 1 ? "" : "s"} waiting on your review or approval`);
  if (facts.length < 2 && mostRecentClosure) facts.push(`I just closed the loop on ${mostRecentClosure.title}`);

  const salutation = timeSalutation(now);
  if (facts.length === 0) return `${salutation} — I'm ready.`;
  return `${salutation}. ${facts.slice(0, 2).join(", and ")}.`;
}

async function buildVoiceGreetingFacts(deps: DayBriefDeps): Promise<string> {
  const now = deps.now();
  const since = new Date(now.getTime() - GREETING_LOOP_CLOSURE_LOOKBACK_MS).toISOString();
  const [nextMeetingTitle, inbox, closures] = await Promise.all([
    safeCall(() => deps.executePimTool("calendar_next_within", { hours: 3 }), ""),
    safeCall(() => deps.getWorkflowInbox(), null as WorkflowInbox | null),
    safeCall(() => deps.listVoiceLoopClosures(since), [] as VoiceLoopClosure[]),
  ]);
  return buildGreetingText(now, nextMeetingTitle.trim(), reviewAttentionCount(inbox), closures[0] ?? null);
}

/**
 * Build the live-call greeting: a <=2-sentence spoken line. Deterministic
 * fallback on ANY error, and a hard deadline so a slow PIM/DB read can never
 * push the route past its latency budget — the caller (GET /voice/greeting)
 * needs this to answer in <1.5s no matter what.
 */
export async function buildVoiceGreeting(deps: DayBriefDeps = defaultDayBriefDeps): Promise<string> {
  try {
    const result = await Promise.race([
      buildVoiceGreetingFacts(deps),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), GREETING_DEADLINE_MS)),
    ]);
    return result ?? GREETING_FALLBACK;
  } catch {
    return GREETING_FALLBACK;
  }
}
