/**
 * Flash Lane — conversation compaction.
 *
 * Flash sessions are everlasting (one row per channel+peer) and the hot path
 * resumes a CLI-side conversation that nothing here bounds, so without
 * compaction a session grows until turns start failing outright — which is
 * what the operator experiences as the model announcing it is "at session end".
 *
 * Compaction is the alternative to the blunt fix (reset the thread and lose
 * everything): fold the old turns into a prose summary, prune them, and drop
 * the CLI session id so the NEXT turn cold-starts from
 * `summary + recent turns` via context.ts's existing assembly. The summary
 * slot in the system prompt and the prune helper both already existed — this
 * module is what finally calls them.
 *
 * Best-effort by construction. Every failure path still performs the part that
 * actually relieves pressure (prune + drop the resume id), because a
 * compaction that refuses to run leaves the session exactly as stuck as it was.
 */

import { haikuChatComplete } from "@/lib/models/chat-client";
import {
  clearFlashCliSessionId,
  getRecentTurns,
  getSession,
  pruneSessionTurns,
  updateSessionSummary,
} from "./store";

/** Turns kept verbatim after a compaction — recent enough to preserve the
 *  immediate thread of conversation, small enough to leave real headroom. */
const KEEP_TURNS = 8;

/** Turns fed to the summarizer (the ones about to be pruned, plus context). */
const SUMMARIZE_TURNS = 40;

/** A summary that outgrows this stops being a compaction, so it is capped. */
const MAX_SUMMARY_CHARS = 2_000;

const SUMMARY_SYSTEM =
  "You compress a running assistant/operator conversation into durable notes. " +
  "Write 3-8 terse bullets capturing: unresolved requests, decisions made, facts about the operator " +
  "worth carrying forward, and any commitments the assistant made. Omit pleasantries and anything " +
  "already resolved. No preamble, bullets only.";

export type CompactReason = "threshold" | "overflow";

export interface CompactResult {
  compacted: boolean;
  summarized: boolean;
  prunedTurns: number;
}

/**
 * Deterministic fallback digest, used when the summarizer is unavailable or
 * fails. Crude but honest — it preserves who said what about what, which is
 * enough for the next turn to not act amnesiac, and it never blocks the prune.
 */
export function buildFallbackSummary(turns: Array<{ role: string; content: string }>): string {
  const lines = turns
    .filter((t) => t.role === "user" || t.role === "assistant")
    .map((t) => {
      const firstLine = t.content.split("\n").find((l) => l.trim())?.trim() ?? "";
      return `- ${t.role}: ${firstLine.slice(0, 120)}`;
    });
  return `(Auto-condensed — summarizer unavailable.)\n${lines.join("\n")}`.slice(0, MAX_SUMMARY_CHARS);
}

/** Merge a new summary into any prior one, newest last, capped. Older content is
 *  dropped from the FRONT so the most recent context always survives the cap. */
export function mergeSummaries(prior: string, next: string): string {
  const merged = prior.trim() ? `${prior.trim()}\n${next.trim()}` : next.trim();
  if (merged.length <= MAX_SUMMARY_CHARS) return merged;
  return merged.slice(merged.length - MAX_SUMMARY_CHARS);
}

/**
 * Compact one Flash session in place.
 *
 * Ordering matters: the summary is written BEFORE the prune, so a crash between
 * the two loses turns that are already represented in the summary rather than
 * losing them silently. Dropping the CLI session id is last, since that is the
 * step that actually forces the next turn onto the cold path where the fresh
 * summary is read.
 */
export async function compactFlashSession(sessionId: string, reason: CompactReason): Promise<CompactResult> {
  const session = getSession(sessionId);
  if (!session) return { compacted: false, summarized: false, prunedTurns: 0 };

  const turns = getRecentTurns(sessionId, SUMMARIZE_TURNS).reverse();
  if (turns.length <= KEEP_TURNS) {
    // Not enough history for a summary to buy anything, but an overflow still
    // has to be relieved — a single enormous turn can fill the window on its
    // own, and only dropping the resume id gets us off that CLI conversation.
    if (reason === "overflow") {
      clearFlashCliSessionId(sessionId);
      return { compacted: true, summarized: false, prunedTurns: 0 };
    }
    return { compacted: false, summarized: false, prunedTurns: 0 };
  }

  const older = turns.slice(0, Math.max(0, turns.length - KEEP_TURNS));

  let summary: string;
  let summarized = false;
  try {
    const transcript = older
      .filter((t) => t.role === "user" || t.role === "assistant")
      .map((t) => `${t.role}: ${t.content.slice(0, 4_000)}`)
      .join("\n\n");
    const out = await haikuChatComplete(
      [
        { role: "system", content: SUMMARY_SYSTEM },
        { role: "user", content: transcript },
      ],
      { timeoutMs: 45_000 },
    );
    summary = out.trim().slice(0, MAX_SUMMARY_CHARS);
    summarized = summary.length > 0;
    if (!summarized) summary = buildFallbackSummary(older);
  } catch (err) {
    console.warn(
      `[flash:compact] summarizer failed for session ${sessionId} (${reason}) — falling back to a digest: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    summary = buildFallbackSummary(older);
  }

  updateSessionSummary(sessionId, mergeSummaries(session.summary ?? "", summary));
  const prunedTurns = pruneSessionTurns(sessionId, KEEP_TURNS);
  clearFlashCliSessionId(sessionId);

  console.log(
    `[flash:compact] session ${sessionId} compacted (${reason}): ` +
      `${prunedTurns} turns pruned, summary ${summarized ? "written" : "fell back to digest"}, resume id dropped`,
  );

  return { compacted: true, summarized, prunedTurns };
}
