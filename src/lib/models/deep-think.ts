/**
 * Deep Think — test-time compute scaling on the local DeepSeek/Qwen model.
 *
 * The operator's tokens are free (M-series, keyless loopback), so the lever for
 * "smarter" is structured extra inference, not a bigger model. This harness
 * implements the four techniques that survive the 2026 test-time-scaling
 * literature for agents:
 *
 *   1. Diversified parallel rollouts — N candidates at varied temperatures,
 *      thinking mode ON (DeepSeek reasoning is the whole point here).
 *   2. Self-consistency signal — cheap pairwise agreement across candidates;
 *      high agreement = the answer is stable, low = the problem is genuinely hard.
 *   3. List-wise synthesis — one temperature-0 pass that sees ALL candidates,
 *      compares them, and produces the final answer (list-wise merging beats
 *      per-candidate reward scoring in the agent-scaling studies).
 *   4. Know-when-to-reflect — only when candidates DISAGREE does a sequential
 *      critique-revise pass run on the synthesis. Easy questions stay cheap.
 *
 * Keyless + local-only by construction: the only backend is localChatComplete
 * (loopback HTTP). No cloud call, ever. `complete` is injectable so tests touch
 * no network and no model.
 */

import { localChatComplete, type ChatComplete } from "./chat-client";

export interface DeepThinkOpts {
  /** Parallel candidates. 3 is the sweet spot for a single local server. */
  samples?: number;
  /** Hard wall-clock budget for the whole pass. */
  maxWallMs?: number;
  /** Per-model-call timeout (thinking mode needs room; default 90s). */
  callTimeoutMs?: number;
  /** Optional system context (persona, task framing) prepended to every call. */
  systemContext?: string;
  complete?: ChatComplete;
}

export interface DeepThinkResult {
  answer: string;
  /** high = candidates agreed; medium = synthesis reconciled; low = disagreement even after revision. */
  confidence: "high" | "medium" | "low";
  candidates: number;
  /** Mean pairwise agreement across candidates, 0..1. */
  agreement: number;
  reflected: boolean;
  elapsedMs: number;
}

const DEFAULT_SAMPLES = 3;
const DEFAULT_WALL_MS = 4 * 60 * 1000;
const DEFAULT_CALL_TIMEOUT_MS = 90_000;
/** Below this mean agreement the candidates genuinely disagree → reflect. */
export const REFLECT_THRESHOLD = 0.45;
/** At/above this the answer is stable → high confidence, no reflection. */
export const STABLE_THRESHOLD = 0.7;

/** Rollout temperatures, cycled — diversity is what makes extra samples pay. */
const ROLLOUT_TEMPERATURES = [0.3, 0.7, 1.0];

export function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

function contentTokens(text: string): Set<string> {
  return new Set(
    stripThinkBlocks(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

/** Pure: Jaccard similarity of content tokens between two answers, 0..1. */
export function answerSimilarity(a: string, b: string): number {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Pure: mean pairwise agreement across candidate answers. 1 for a single candidate. */
export function meanAgreement(candidates: string[]): number {
  if (candidates.length < 2) return 1;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      sum += answerSimilarity(candidates[i], candidates[j]);
      pairs++;
    }
  }
  return pairs > 0 ? sum / pairs : 1;
}

/** Pure: the list-wise synthesis prompt — sees every candidate at once. */
export function buildSynthesisPrompt(question: string, candidates: string[]): string {
  const blocks = candidates.map((c, i) => `### Candidate ${i + 1}\n${stripThinkBlocks(c).slice(0, 4000)}`);
  return [
    "Several independent attempts were made at the question below. Compare them list-wise:",
    "where they agree, that content is probably right; where they conflict, reason about which is correct.",
    "Then write the single best final answer. Do not mention the candidates or this process in the answer.",
    "",
    `## Question\n${question}`,
    "",
    blocks.join("\n\n"),
    "",
    "## Final answer",
  ].join("\n");
}

/** Pure: the critique-revise prompt used only when candidates disagreed. */
export function buildReflectionPrompt(question: string, draft: string): string {
  return [
    "The independent attempts at this question DISAGREED with each other, so the draft answer below is suspect.",
    "Act as a skeptical reviewer: find the weakest claim in the draft, check it step by step,",
    "and produce a corrected final answer. If the draft survives scrutiny, keep it. Answer only — no meta-commentary.",
    "",
    `## Question\n${question}`,
    "",
    `## Draft answer\n${stripThinkBlocks(draft).slice(0, 4000)}`,
    "",
    "## Corrected final answer",
  ].join("\n");
}

/**
 * Run one deep-think pass. Never throws on partial failure — any completed
 * candidates are used; a total failure rejects (caller handles).
 */
export async function deepThink(question: string, opts: DeepThinkOpts = {}): Promise<DeepThinkResult> {
  const started = Date.now();
  const complete = opts.complete ?? localChatComplete;
  const samples = Math.max(1, Math.min(8, opts.samples ?? DEFAULT_SAMPLES));
  const wallMs = opts.maxWallMs ?? DEFAULT_WALL_MS;
  const callTimeoutMs = opts.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const system = opts.systemContext?.trim();
  const baseMessages = (userText: string) => [
    ...(system ? [{ role: "system" as const, content: system }] : []),
    { role: "user" as const, content: userText },
  ];

  // 1) Diversified parallel rollouts, thinking ON. The wall is enforced HERE
  // too: a local server that serializes requests would otherwise queue rollouts
  // past the budget (each per-call timeout only starts when its fetch fires).
  // Reserve one call's worth of budget for the synthesis/reflection phase.
  const rolloutDeadlineMs = Math.max(10_000, Math.min(wallMs - callTimeoutMs, samples * callTimeoutMs));
  const withDeadline = <T,>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("deep-think rollout deadline")), rolloutDeadlineMs).unref?.(),
      ),
    ]);
  const rollouts = await Promise.allSettled(
    Array.from({ length: samples }, (_, i) =>
      withDeadline(
        complete(baseMessages(question), {
          temperature: ROLLOUT_TEMPERATURES[i % ROLLOUT_TEMPERATURES.length],
          reasoningEffort: "high",
          maxTokens: 2048,
          timeoutMs: callTimeoutMs,
        }),
      ),
    ),
  );
  const candidates = rollouts
    .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
    .map((r) => stripThinkBlocks(r.value))
    .filter((c) => c.length > 0);
  if (candidates.length === 0) {
    const firstErr = rollouts.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason;
    throw new Error(`deep-think: all rollouts failed: ${firstErr instanceof Error ? firstErr.message : firstErr}`);
  }

  // 2) Self-consistency signal.
  const agreement = meanAgreement(candidates);

  // Single usable candidate (others failed) — return it honestly as low confidence.
  if (candidates.length === 1) {
    return { answer: candidates[0], confidence: "low", candidates: 1, agreement, reflected: false, elapsedMs: Date.now() - started };
  }

  // 3) List-wise synthesis at temperature 0.
  let answer = candidates[0];
  try {
    answer = stripThinkBlocks(
      await complete(baseMessages(buildSynthesisPrompt(question, candidates)), {
        temperature: 0,
        reasoningEffort: "high",
        maxTokens: 2048,
        timeoutMs: callTimeoutMs,
      }),
    ) || candidates[0];
  } catch { /* keep the first candidate — synthesis is an enhancement, not a dependency */ }

  // 4) Reflect ONLY when candidates disagreed and the budget allows.
  let reflected = false;
  if (agreement < REFLECT_THRESHOLD && Date.now() - started < wallMs - callTimeoutMs) {
    try {
      const revised = stripThinkBlocks(
        await complete(baseMessages(buildReflectionPrompt(question, answer)), {
          temperature: 0,
          reasoningEffort: "high",
          maxTokens: 2048,
          timeoutMs: callTimeoutMs,
        }),
      );
      if (revised) { answer = revised; reflected = true; }
    } catch { /* best effort */ }
  }

  const confidence: DeepThinkResult["confidence"] =
    agreement >= STABLE_THRESHOLD ? "high" : agreement >= REFLECT_THRESHOLD ? "medium" : "low";
  return { answer, confidence, candidates: candidates.length, agreement, reflected, elapsedMs: Date.now() - started };
}
