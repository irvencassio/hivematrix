/**
 * Weaver Audit — the operator's own accountability-auditor persona, armed
 * (2026-07-10 "Capability Ratchet + Weaver Audit" spec). Weekly, diff stated
 * commitments (GOALS.md + a `brain_search` pass for plans/deadlines) against
 * observed activity (tasks completed in the last 7 days) and text the
 * operator ONE uncomfortable question. Rides the heartbeat tick exactly like
 * the Day Brief ritual: own enable flag (`weaverEnabled`, default off), own
 * weekly idempotence key. No new scheduler, no new persistent store.
 *
 * "Weaver 🌀" here is the accountability-auditor persona this spec assigns to
 * the weekly audit's voice — distinct from the retired AuthBee/session
 * internal codename scope-wall.mjs otherwise still forbids as a public
 * brand (see DECISIONS.md's 2026-07-10 entry disambiguating the two).
 *
 * Unlike day-brief.ts's "ONE thing" line (model failure -> omit the line) or
 * ratchet.ts (model failure -> deterministic fallback), a Weaver audit with
 * no model insight is noise, not signal: a model failure sends NOTHING, by
 * spec. Dep-injected the same way day-brief.ts is: a `WeaverAuditDeps` bag of
 * injectable fetchers, `defaultWeaverAuditDeps` wiring the real
 * implementations; `composeWeaverAudit` is the one non-pure entry point.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Task } from "@/lib/db";
import { searchBrain } from "@/lib/brain/search";
import { configuredBrainRootDir } from "@/lib/brain/settings";
import { haikuChatComplete, type ChatComplete } from "@/lib/models/chat-client";

export interface WeaverBrainHit {
  path: string;
  snippet: string;
}

export interface WeaverCompletedTask {
  title: string;
}

const WEAVER_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const WEAVER_MAX_TOKENS = 300;
const WEAVER_MAX_LINES = 4;
const BRAIN_SNIPPET_CHARS = 2000;
export const WEAVER_BRAIN_QUERY = "plan OR deadline OR by August";

// ---------------------------------------------------------------------------
// Dependencies — pure logic is injected; defaults wire the real IO.
// ---------------------------------------------------------------------------

export interface WeaverAuditDeps {
  /** GOALS.md persona content, if present (same discovery as day-brief.ts). */
  readGoalsPersona: () => string | null;
  /** brain_search lib call (not the model-facing tool) — top 3 docs for commitments. */
  searchBrainDocs: (query: string) => Promise<WeaverBrainHit[]>;
  /** Tasks completed in the last 7 days. */
  listCompletedTasks: (sinceIso: string) => Promise<WeaverCompletedTask[]> | WeaverCompletedTask[];
  /** Haiku audit pass. Any failure means send NOTHING — no fallback. */
  chatComplete: ChatComplete;
  now: () => Date;
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

async function defaultSearchBrainDocs(query: string): Promise<WeaverBrainHit[]> {
  const result = await searchBrain(query, { maxResults: 3, snippetChars: BRAIN_SNIPPET_CHARS });
  return result.hits.map((h) => ({ path: h.path, snippet: h.snippet }));
}

async function defaultListCompletedTasks(sinceIso: string): Promise<WeaverCompletedTask[]> {
  const rows = await Task.find({ status: "done", completedAt: { $gte: sinceIso } }).sort({ completedAt: -1 }).limit(30);
  return rows.map((t) => ({ title: t.title }));
}

export const defaultWeaverAuditDeps: WeaverAuditDeps = {
  readGoalsPersona: defaultReadGoalsPersona,
  searchBrainDocs: defaultSearchBrainDocs,
  listCompletedTasks: defaultListCompletedTasks,
  chatComplete: haikuChatComplete,
  now: () => new Date(),
};

// ---------------------------------------------------------------------------
// Small IO helper — never throw; a missing/failing fact just drops its input.
// ---------------------------------------------------------------------------

async function safeCall<T>(fn: () => Promise<T> | T, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Pure decision + text-building pieces
// ---------------------------------------------------------------------------

/** Pure: nothing to audit against — no goals, no brain hits, no activity at all. */
export function hasWeaverSignal(
  goalsPersona: string | null,
  brainHits: WeaverBrainHit[],
  completed: WeaverCompletedTask[],
): boolean {
  return Boolean(goalsPersona) || brainHits.length > 0 || completed.length > 0;
}

/** Pure: render commitments (GOALS.md + brain hits) into the model's user-message text. */
export function buildWeaverCommitmentsText(goalsPersona: string | null, brainHits: WeaverBrainHit[]): string {
  const parts: string[] = [];
  if (goalsPersona) parts.push(`GOALS.md:\n${goalsPersona}`);
  if (brainHits.length > 0) {
    const hitsText = brainHits.map((h) => `- ${h.path}: ${h.snippet}`).join("\n");
    parts.push(`Other stated commitments (brain search):\n${hitsText}`);
  }
  return parts.length > 0 ? parts.join("\n\n") : "(no stated commitments found)";
}

/** Pure: render this week's completed task titles into the model's user-message text. */
export function buildWeaverActivityText(completed: WeaverCompletedTask[]): string {
  if (completed.length === 0) return "(nothing completed in the last 7 days)";
  return completed.map((t) => `- ${t.title}`).join("\n");
}

/** Pure: build the Weaver persona prompt. */
export function buildWeaverPrompt(commitmentsText: string, activityText: string): { system: string; user: string } {
  const system = [
    "You are Weaver 🌀, the operator's accountability auditor.",
    "Given their stated commitments and this week's observed activity, write AT MOST 4 short lines:",
    "what moved, what's slipping against a stated deadline, and ONE direct uncomfortable question.",
    "No markdown, no preamble, no headers — just the lines. Be specific, not generic.",
  ].join("\n");
  const user = `Commitments:\n${commitmentsText}\n\nThis week's activity:\n${activityText}`;
  return { system, user };
}

/** Pure: enforce the <=4-line output contract defensively, in case the model over-produces. */
export function clampWeaverLines(text: string, maxLines: number = WEAVER_MAX_LINES): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.slice(0, maxLines).join("\n");
}

// ---------------------------------------------------------------------------
// composeWeaverAudit — the one non-pure entry point.
// ---------------------------------------------------------------------------

/**
 * Assemble the weekly Weaver audit text, or null when there is nothing
 * worth sending: no signal at all to audit against, an empty model reply,
 * or a model failure. Unlike day-brief.ts / ratchet.ts, there is deliberately
 * NO deterministic fallback here — an audit with no model insight is noise.
 */
export async function composeWeaverAudit(deps: WeaverAuditDeps = defaultWeaverAuditDeps): Promise<string | null> {
  const now = deps.now();
  const since = new Date(now.getTime() - WEAVER_LOOKBACK_MS).toISOString();

  const [goalsPersona, brainHits, completed] = await Promise.all([
    safeCall(() => deps.readGoalsPersona(), null as string | null),
    safeCall(() => deps.searchBrainDocs(WEAVER_BRAIN_QUERY), [] as WeaverBrainHit[]),
    safeCall(() => deps.listCompletedTasks(since), [] as WeaverCompletedTask[]),
  ]);

  if (!hasWeaverSignal(goalsPersona, brainHits, completed)) return null;

  const { system, user } = buildWeaverPrompt(
    buildWeaverCommitmentsText(goalsPersona, brainHits),
    buildWeaverActivityText(completed),
  );

  try {
    const reply = await deps.chatComplete(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { temperature: 0, maxTokens: WEAVER_MAX_TOKENS },
    );
    const cleaned = reply.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (!cleaned) return null;
    return clampWeaverLines(cleaned);
  } catch {
    return null; // model failure -> send NOTHING, no fallback (by spec)
  }
}
