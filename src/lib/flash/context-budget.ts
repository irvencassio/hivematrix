/**
 * Flash Lane — context budget accounting and CLI failure classification.
 *
 * Pure and dependency-free on purpose: every function here is a deterministic
 * transform over strings/numbers so the classification rules can be unit tested
 * without a real `claude` subprocess or a DB.
 *
 * Why this module exists: Flash sessions are everlasting (one row per
 * channel+peer, resumed forever) and the hot path passes `--resume`, which
 * hands history to the CLI with no bound this side of the process. The 20-turn
 * cap in context.ts only applies to the cold path. So the conversation grows
 * until it hits the model's context window, and before this module there was
 * no code that could even name that failure — see classifyFlashFailure below.
 */

/**
 * Context window per model, in tokens. Keyed by a substring of the resolved
 * model id from the stream-json `system:init` event (e.g. "claude-haiku-4-5").
 *
 * Hardcoded because nothing in the repo carries context-window metadata — the
 * model catalog tracks availability and cost, not limits — and Flash pins
 * itself to `--model haiku` (loop.ts). Add entries here rather than teaching
 * the gauge to guess: a wrong limit makes the gauge lie in the direction that
 * matters (reading "half full" at the moment a turn is about to fail).
 */
const CONTEXT_WINDOWS: ReadonlyArray<readonly [pattern: string, tokens: number]> = [
  ["haiku-4-5", 200_000],
  ["haiku", 200_000],
  ["sonnet", 200_000],
  ["opus", 200_000],
];

/** Fallback when the model id is unknown or absent (the init event never arrived). */
const DEFAULT_CONTEXT_WINDOW = 200_000;

/**
 * The share of the window we treat as usable input. The model needs headroom
 * to write its reply into the same window, so a session at 100% of the raw
 * limit has already failed. Compaction targets this, not the raw ceiling.
 */
const USABLE_FRACTION = 0.9;

/**
 * Window for a long-context variant. The CLI reports these back with an
 * explicit "[1m]" marker on the model id (e.g. "claude-opus-4-8[1m]"), which
 * console.ts and observability/contracts.ts already parse and price separately.
 * Reading that marker is not guessing — it is a declared capability carried in
 * the id — so the table's "add entries rather than guess" rule is satisfied.
 *
 * Without this the gauge capped every model at 200k regardless of what it could
 * actually hold, and compaction started folding turns away at ~135k on a
 * session with five times that available.
 */
const LONG_CONTEXT_MARKER = "[1m]";
const LONG_CONTEXT_WINDOW = 1_000_000;

/** Raw context window for a resolved model id. */
export function contextWindowFor(model: string | null | undefined): number {
  if (!model) return DEFAULT_CONTEXT_WINDOW;
  const id = model.toLowerCase();
  if (id.includes(LONG_CONTEXT_MARKER)) return LONG_CONTEXT_WINDOW;
  for (const [pattern, tokens] of CONTEXT_WINDOWS) {
    if (id.includes(pattern)) return tokens;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

/** Usable input budget — the window minus reply headroom. The gauge and the
 *  compaction threshold both measure against this, so "100%" means "the next
 *  turn will fail", not "the window is exactly full". */
export function usableContextFor(model: string | null | undefined): number {
  return Math.floor(contextWindowFor(model) * USABLE_FRACTION);
}

/**
 * Total tokens occupying the context window for a turn.
 *
 * This is just `inputTokens`, because the stream parser ALREADY folds the cache
 * tokens into it — see orchestrator/stream-parser.ts:
 *
 *     const inputTok = baseInput + cacheCreate + cacheRead;
 *
 * Adding `cacheReadTokens + cacheCreationTokens` on top double-counts every
 * cached token. That was the original bug here: on a resumed turn nearly the
 * whole conversation arrives as a cache read, so the doubling roughly doubled
 * the reading — a fresh session showed ~50% after a single turn, and one
 * session recorded 203,648 tokens against a 200,000-token window, which is
 * impossible for real occupancy (the request would have been rejected).
 *
 * The cache tokens still matter conceptually — a `--resume` turn replays the
 * prior conversation from the prompt cache, so counting only `baseInput` would
 * report the fullest sessions as the emptiest. The parser already handles that;
 * this function must not do it a second time.
 *
 * Output tokens are excluded: they are not in the window at request time. They
 * land in the NEXT turn's history, so the gauge trails true occupancy by one
 * reply — acceptable for a warning indicator, and it errs low by a bounded
 * amount rather than drifting.
 */
export function computeContextTokens(usage: {
  inputTokens?: number | null;
} | null | undefined): number {
  if (!usage) return 0;
  return usage.inputTokens ?? 0;
}

export type ContextLevel = "ok" | "notice" | "warn" | "critical";

/**
 * Display band for a fill fraction. "ok" is deliberately silent — a gauge that
 * is always on screen becomes furniture the operator stops reading, which
 * defeats the point of having one.
 */
export function contextLevel(fill: number): ContextLevel {
  if (fill >= 0.9) return "critical";
  if (fill >= 0.75) return "warn";
  if (fill >= 0.5) return "notice";
  return "ok";
}

/** Fraction of the usable budget consumed, clamped to [0, 1]. */
export function contextFill(tokens: number, model: string | null | undefined): number {
  const usable = usableContextFor(model);
  if (usable <= 0) return 0;
  return Math.min(1, Math.max(0, tokens / usable));
}

/** At or past this fill, a completed turn triggers compaction (see compact.ts). */
export const COMPACT_THRESHOLD = 0.75;

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

/**
 * Context-window exhaustion, as reported by the Anthropic API through the CLI.
 * Covers the API's own phrasing ("prompt is too long: N tokens > M maximum",
 * "input length and `max_tokens` exceed context limit") plus the
 * OpenAI-compatible spellings the CLI may pass through verbatim.
 */
const CONTEXT_OVERFLOW_RE =
  /prompt is too long|context[_ ]length[_ ]exceeded|exceed(s)? (the )?context (limit|window|length)|maximum context length|context window (is )?(full|exceeded)|too many (input )?tokens/i;

/**
 * A `--resume` attempt failing at session lookup — stale/expired CLI session
 * (daemon restart, CLI-side pruning). Retried once without --resume.
 */
const STALE_RESUME_RE = /\bsession\b|\bresume\b/i;

export type FlashFailureKind = "context-overflow" | "stale-resume" | "other";

/**
 * Classify a failed CLI attempt from its stderr + text.
 *
 * ORDER IS LOAD-BEARING: overflow is tested before staleness. The stale test is
 * a bare /session|resume/ match, and a context overflow on a resumed session
 * can easily mention the session it was resuming ("Error resuming session
 * abc123: prompt is too long"). Classified as stale, that would drop the
 * cliSessionId and retry with a 20-turn cold serialization — a retry that may
 * well SUCCEED, which is the dangerous part: the real cause is silently
 * "recovered" and every log line says "stale session". The operator then sees
 * a chat that periodically forgets itself with no signal as to why.
 *
 * Testing overflow first makes that misdiagnosis structurally impossible
 * rather than merely unlikely.
 *
 * A non-failing attempt (exitCode 0 or null) is never classified — callers
 * gate on exit code first.
 */
export function classifyFlashFailure(stderr: string, text: string): FlashFailureKind {
  const haystack = `${stderr} ${text}`;
  if (CONTEXT_OVERFLOW_RE.test(haystack)) return "context-overflow";
  if (STALE_RESUME_RE.test(haystack)) return "stale-resume";
  return "other";
}
