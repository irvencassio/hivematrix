/**
 * Client-side context budget enforcement for local-model dispatch.
 *
 * Rapid-MLX `serve` has no context-size flag (MLX grows the KV cache lazily —
 * there is no buffer to pre-size), and both resident Qwen3.6 models declare a
 * 262,144-token window. Nothing server-side stops an agent conversation from
 * reaching it; the failure mode is memory pressure and swap, not a clean
 * error. This module is the only place a configured `contextLimit` has any
 * effect (2026-07-09 local-model-tuning spec, §3.3).
 *
 * Mutates the given `messages` array in place (matching the generic-agent
 * loop's existing push-in-place usage) rather than returning a new array —
 * callers holding a reference see the compaction without reassignment.
 */

export interface ContextGovernorResult {
  compacted: boolean;
  droppedCount: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
}

export class ContextBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextBudgetExceededError";
  }
}

/** chars/3.5 — adequate for a budget guard; not worth a tokenizer dependency. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function messageTokens(message: Record<string, unknown>): number {
  const content = message.content;
  const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
  return estimateTokens(text) + 4; // small per-message role/formatting overhead
}

function sumTokens(messages: Array<Record<string, unknown>>): number {
  return messages.reduce((sum, m) => sum + messageTokens(m), 0);
}

/**
 * Ensures `messages` fits within `contextLimit - maxOutputTokens` tokens,
 * compacting by dropping the oldest non-system, non-final-turn messages first.
 * Throws ContextBudgetExceededError if the system messages + the single most
 * recent turn alone exceed the budget — that turn cannot be dropped, so there
 * is nothing left to compact.
 */
export function governContext(
  messages: Array<Record<string, unknown>>,
  opts: { contextLimit: number; maxOutputTokens: number },
): ContextGovernorResult {
  const budget = opts.contextLimit - opts.maxOutputTokens;
  const before = sumTokens(messages);

  if (before <= budget) {
    return { compacted: false, droppedCount: 0, estimatedTokensBefore: before, estimatedTokensAfter: before };
  }

  let dropped = 0;
  while (sumTokens(messages) > budget) {
    const idx = messages.findIndex((m, j) => m.role !== "system" && j !== messages.length - 1);
    if (idx === -1) break; // nothing droppable left
    messages.splice(idx, 1);
    dropped++;
  }

  const after = sumTokens(messages);
  if (after > budget) {
    throw new ContextBudgetExceededError(
      `Local model context budget exceeded even after dropping ${dropped} older turn(s): ` +
      `~${after} tokens remain against a ~${budget}-token budget ` +
      `(contextLimit=${opts.contextLimit}, reserved ${opts.maxOutputTokens} for generation). ` +
      `The most recent turn alone is too large to send — split the work into smaller turns.`
    );
  }

  return { compacted: true, droppedCount: dropped, estimatedTokensBefore: before, estimatedTokensAfter: after };
}
