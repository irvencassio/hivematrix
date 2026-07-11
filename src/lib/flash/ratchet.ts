/**
 * Capability Ratchet — every voice escalation is a confession of a missing
 * live capability (2026-07-10 spec, see
 * docs/superpowers/specs/2026-07-10-ratchet-and-weaver-spec.md).
 * Weekly, cluster the last 7 days of terminal voice-origin tasks by the
 * capability that was missing and PROPOSE the next tool to build — a new
 * HiveMatrix task titled "Ratchet: build <tool>", plus a short `notify()`
 * text. Rides the heartbeat tick (heartbeat.ts) exactly like the Day Brief
 * ritual (day-brief.ts): own enable flag (`ratchetEnabled`, default off),
 * own weekly idempotence key. No new scheduler, no new persistent store.
 *
 * Voice-origin tasks carry `output.origin === "voice"` (see
 * src/lib/voice/loop-closer.ts's header note on the storage choice — the same
 * JSON `output` column, no SQL path into it, so the candidate set is bounded
 * by `updatedAt` and filtered precisely in JS). flash/ does not import voice/
 * (see COMPONENT-MAP.md's flash/ scope line), so the terminal-status set is
 * duplicated here rather than imported — keep it in sync with loop-closer.ts
 * if that set ever changes.
 *
 * Dep-injected the same way day-brief.ts is: `RatchetDeps` bag of injectable
 * fetchers/effects, `defaultRatchetDeps` wiring the real implementations.
 * `runRatchetPass` is the one non-pure entry point (fetch + model + task
 * creation); everything else here is a pure, unit-tested building block.
 */

import { Task, generateId } from "@/lib/db";
import { haikuChatComplete, type ChatComplete } from "@/lib/models/chat-client";

export interface RatchetEscalation {
  title: string;
  description: string;
}

export interface RatchetProposal {
  taskTitle: string;
  taskDescription: string;
  notifyText: string;
}

export interface RatchetRunResult {
  created: boolean;
  notifyText: string | null;
  taskId?: string;
}

const RATCHET_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const RATCHET_MAX_TOKENS = 400;

// Mirrors loop-closer.ts's TERMINAL_STATUSES — a voice escalation is only a
// signal once its task has actually finished (not still running/queued).
const RATCHET_TERMINAL_STATUSES: ReadonlySet<string> = new Set(["review", "done", "failed", "cancelled", "archived"]);

// ---------------------------------------------------------------------------
// Dependencies — pure logic is injected; defaults wire the real IO.
// ---------------------------------------------------------------------------

export interface RatchetDeps {
  /** Terminal voice-origin tasks updated at/after `sinceIso`, most-recent first. */
  listVoiceEscalations: (sinceIso: string) => Promise<RatchetEscalation[]> | RatchetEscalation[];
  /** Haiku clustering pass. Any failure falls back to the deterministic listing. */
  chatComplete: ChatComplete;
  /** Create the proposal task — same shape `escalate_to_task` uses (see flash/loop.ts). */
  createTask: (payload: { title: string; description: string }) => Promise<{ _id: string }>;
  now: () => Date;
}

async function defaultListVoiceEscalations(sinceIso: string): Promise<RatchetEscalation[]> {
  const rows = await Task.find({ updatedAt: { $gte: sinceIso } }).sort({ updatedAt: -1 }).limit(100);
  return rows
    .filter((t) => {
      const output = (t.output ?? {}) as Record<string, unknown>;
      return output.origin === "voice" && RATCHET_TERMINAL_STATUSES.has(t.status);
    })
    .map((t) => ({ title: t.title, description: (t.description ?? "").slice(0, 300) }));
}

async function defaultCreateTask(payload: { title: string; description: string }): Promise<{ _id: string }> {
  const task = await Task.create({
    _id: generateId(),
    title: payload.title,
    description: payload.description,
    project: "hivematrix",
    projectPath: process.env.HOME ?? "/",
    executor: "agent",
    model: "mixed",
    workflow: "work",
    source: "flash:ratchet",
  });
  return { _id: task._id };
}

export const defaultRatchetDeps: RatchetDeps = {
  listVoiceEscalations: defaultListVoiceEscalations,
  chatComplete: haikuChatComplete,
  createTask: defaultCreateTask,
  now: () => new Date(),
};

// ---------------------------------------------------------------------------
// Pure decision + prompt-building pieces
// ---------------------------------------------------------------------------

/** Pure: zero escalations this week means a complete no-op (no task, no text). */
export function shouldSkipRatchet(escalations: RatchetEscalation[]): boolean {
  return escalations.length === 0;
}

/** Pure: build the clustering prompt. Structured reply format keeps parsing deterministic. */
export function buildRatchetPrompt(escalations: RatchetEscalation[]): { system: string; user: string } {
  const system = [
    "You are analyzing a week of voice requests a live voice assistant could not handle live — each was",
    "escalated to a background task instead. Cluster these by the capability that was missing, and name the",
    "ONE tool that would have handled the most of them if it existed live.",
    "Respond in EXACTLY this format, no markdown, no preamble:",
    "Tool: <short tool name, 3-6 words>",
    "<exactly 3 sentences describing what the tool would do and why it covers the most escalations>",
  ].join("\n");
  const user = escalations
    .map((e, i) => `${i + 1}. ${e.title}${e.description ? ` — ${e.description}` : ""}`)
    .join("\n");
  return { system, user };
}

/** Pure: deterministic fallback when the model call fails — no clustering, just the facts. */
export function deterministicRatchetFallback(escalations: RatchetEscalation[]): string {
  const top3 = escalations.slice(0, 3).map((e) => `- ${e.title}`).join("\n");
  return `Model clustering was unavailable this week. Most recent voice escalations:\n${top3}`;
}

/** Pure: parse the model's structured reply; null when it didn't follow the format. */
export function parseRatchetModelReply(reply: string): { tool: string; analysis: string } | null {
  const cleaned = reply.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const match = cleaned.match(/^Tool:\s*(.+?)\s*\n([\s\S]+)$/);
  if (!match) return null;
  const tool = match[1].trim();
  const analysis = match[2].trim();
  if (!tool || !analysis) return null;
  return { tool, analysis };
}

/** Pure: assemble the task + notify payload from a parsed proposal (or the deterministic fallback). */
export function buildRatchetProposal(
  escalationCount: number,
  parsed: { tool: string; analysis: string } | null,
  fallbackText: string,
): RatchetProposal {
  const times = `${escalationCount} time${escalationCount === 1 ? "" : "s"}`;
  if (parsed) {
    return {
      taskTitle: `Ratchet: build ${parsed.tool}`,
      taskDescription: parsed.analysis,
      notifyText: `Voice couldn't handle it live ${times} this week.\nI've queued a proposal to build ${parsed.tool}.`,
    };
  }
  return {
    taskTitle: "Ratchet: review this week's voice escalations",
    taskDescription: fallbackText,
    notifyText: `Voice couldn't handle it live ${times} this week.\nClustering failed, so I queued a review task with the recent misses instead.`,
  };
}

// ---------------------------------------------------------------------------
// runRatchetPass — the one non-pure entry point.
// ---------------------------------------------------------------------------

/**
 * Fetch the last 7 days of terminal voice-origin tasks, cluster them (one
 * local-model pass, deterministic fallback on failure), and — unless there
 * were zero escalations — create the proposal task and return its notify
 * text. Never throws: a fetch/model failure degrades to the deterministic
 * path rather than failing the whole pass; only genuinely nothing-to-do
 * (zero escalations) returns `created: false`.
 */
export async function runRatchetPass(deps: RatchetDeps = defaultRatchetDeps): Promise<RatchetRunResult> {
  const now = deps.now();
  const since = new Date(now.getTime() - RATCHET_LOOKBACK_MS).toISOString();
  const escalations = await deps.listVoiceEscalations(since);

  if (shouldSkipRatchet(escalations)) return { created: false, notifyText: null };

  const { system, user } = buildRatchetPrompt(escalations);
  let parsed: { tool: string; analysis: string } | null = null;
  try {
    const reply = await deps.chatComplete(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { temperature: 0, maxTokens: RATCHET_MAX_TOKENS },
    );
    parsed = parseRatchetModelReply(reply);
  } catch {
    parsed = null; // model failure — fall through to the deterministic fallback
  }

  const proposal = buildRatchetProposal(escalations.length, parsed, deterministicRatchetFallback(escalations));
  const task = await deps.createTask({ title: proposal.taskTitle, description: proposal.taskDescription });
  return { created: true, notifyText: proposal.notifyText, taskId: task._id };
}
