import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { writeJsonAtomic } from "@/lib/config/atomic-write";

export type QwenLocation = "local" | "lan" | "public";
export type QwenProvider = "mlx" | "vllm" | "ollama" | "lmstudio";

export interface QwenModelConfig {
  modelId: string;
  endpoint: string;
  provider: QwenProvider;
  contextLimit: number;
  /** Cap on tokens generated per turn — NOT the context window. Reasoning
   * tokens (Qwen's reasoning_content) draw from this same budget. */
  maxOutputTokens: number;
}

/** Per-request decode controls for the Flash lane. Sent on every chat/completions call
 * (see flash/loop.ts streamFromLocalModel) and the operator-tunable defense against
 * runaway repetition / word-salad degeneration.
 *
 * Empirically calibrated against the live rapid-mlx server (July 2026), which — unlike
 * the vLLM/SGLang reference server the Qwen model card assumes — honors `top_k`,
 * `min_p`, and `repetition_penalty` per-request but only weakly honors `presence_penalty`
 * (verified by A/B probes). The key lever we long omitted is `top_k`: without it the
 * model samples from its full vocabulary tail at every step, which at low temperature on
 * a 4-bit quant is the primary degeneration mechanism. `topK`/`minP` clamp that tail.
 * QWEN_RECOMMENDED_SAMPLING holds the model-card values as a one-click preset. */
export interface SamplingParams {
  temperature: number;
  topP: number;
  /** Keep only the K highest-probability tokens each step. 0 = disabled. The lever the
   * Qwen card recommends (20) and the strongest anti-tail-degeneration knob rapid-mlx
   * honors. */
  topK: number;
  /** Drop tokens below minP × top-token probability. 0 = disabled. */
  minP: number;
  presencePenalty: number;
  frequencyPenalty: number;
  repetitionPenalty: number;
  maxTokens: number;
  /** HiveMatrix-side runaway guard: hard-stop a Flash reply once it exceeds this many
   * characters at a sentence/whitespace boundary. Catches *varied* rambling (a
   * word-salad of distinct words) that the repetition guards structurally can't see —
   * and prevents a degenerate turn from poisoning later turns' context. This is a
   * client-side cap enforced in loop.ts, NOT a model param, so it bounds output even
   * when the server ignores penalties. */
  maxReplyChars: number;
}

/** HiveMatrix defaults — empirically tuned for rapid-mlx (adds the honored top_k=20 the
 * code long omitted; keeps the repetition_penalty rapid-mlx honors rather than Qwen's
 * 1.0, which regressed in A/B testing on this server). */
export const DEFAULT_SAMPLING: SamplingParams = {
  temperature: 0.6,
  topP: 0.9,
  topK: 20,
  minP: 0,
  presencePenalty: 0.3,
  frequencyPenalty: 0.4,
  repetitionPenalty: 1.15,
  // Model-level output cap. Lowered from 2048: a chat/voice reply never needs that
  // much, and a smaller ceiling bounds any degeneration to something recoverable.
  maxTokens: 1024,
  maxReplyChars: 3000,
};

/** Qwen3.6 model-card recommendation for instruct/non-thinking mode. Exposed as a
 * one-click preset so the documented values are visible and applyable — but NOT the
 * default, because A/B probes showed rapid-mlx honors presence_penalty weakly, so the
 * card's "repetition_penalty 1.0 + presence_penalty 1.5" combo degenerates more here
 * than the HiveMatrix defaults. maxTokens/maxReplyChars are HiveMatrix guards, not model
 * params, so they carry over from the defaults. */
export const QWEN_RECOMMENDED_SAMPLING: SamplingParams = {
  temperature: 0.7,
  topP: 0.8,
  topK: 20,
  minP: 0,
  presencePenalty: 1.5,
  frequencyPenalty: 0,
  repetitionPenalty: 1.0,
  maxTokens: DEFAULT_SAMPLING.maxTokens,
  maxReplyChars: DEFAULT_SAMPLING.maxReplyChars,
};

/** Slider bounds + step for each sampling param — surfaced to the settings UI so
 * it never hardcodes ranges, and reused by validateSampling as the clamp window.
 * A `step >= 1` marks an integer-valued param (rounded on parse/validate). */
export const SAMPLING_BOUNDS: Record<keyof SamplingParams, { min: number; max: number; step: number }> = {
  temperature: { min: 0, max: 1.5, step: 0.05 },
  topP: { min: 0.1, max: 1, step: 0.05 },
  topK: { min: 0, max: 100, step: 1 },
  minP: { min: 0, max: 0.5, step: 0.01 },
  presencePenalty: { min: 0, max: 2, step: 0.1 },
  frequencyPenalty: { min: 0, max: 2, step: 0.1 },
  repetitionPenalty: { min: 1, max: 1.5, step: 0.01 },
  maxTokens: { min: 256, max: 8192, step: 256 },
  maxReplyChars: { min: 500, max: 8000, step: 250 },
};

export interface QwenProfile {
  location: QwenLocation;
  primary: QwenModelConfig;
  secondary: QwenModelConfig | null;
  thinkingEnabled: boolean;
  minDecodeRate: number;
  probeTimeoutMs: number;
  sampling: SamplingParams;
}

const DEFAULT_CONTEXT_LIMIT = 32768;
const DEFAULT_MAX_OUTPUT_TOKENS = 16384;
const DEFAULT_MIN_DECODE_RATE = 15;
const DEFAULT_PROBE_TIMEOUT_MS = 60_000;
const DEFAULT_THINKING_ENABLED = false;

const DEFAULT_PRIMARY: QwenModelConfig = {
  modelId: "Qwen3-Coder-Next-80B-A3B",
  endpoint: "http://localhost:8080",
  provider: "mlx",
  contextLimit: 262144,
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
};

function coerceProvider(p: unknown): QwenProvider {
  if (p === "mlx" || p === "vllm" || p === "ollama" || p === "lmstudio") return p;
  return "mlx";
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Parse + clamp a raw sampling blob; any missing/invalid field falls back to
 * its default, and every value is clamped into SAMPLING_BOUNDS. */
function parseSampling(raw: unknown): SamplingParams {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SAMPLING };
  const r = raw as Record<string, unknown>;
  const out = { ...DEFAULT_SAMPLING };
  for (const key of Object.keys(SAMPLING_BOUNDS) as (keyof SamplingParams)[]) {
    const v = r[key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const b = SAMPLING_BOUNDS[key];
    const clamped = clamp(v, b.min, b.max);
    out[key] = b.step >= 1 ? Math.round(clamped) : clamped; // step >= 1 ⇒ integer param
  }
  return out;
}

function parseModelConfig(raw: unknown, fallback: QwenModelConfig): QwenModelConfig {
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const contextLimit = typeof r.contextLimit === "number" && r.contextLimit > 0
    ? r.contextLimit
    : DEFAULT_CONTEXT_LIMIT;
  const requestedOutput = typeof r.maxOutputTokens === "number" && r.maxOutputTokens > 0
    ? r.maxOutputTokens
    : DEFAULT_MAX_OUTPUT_TOKENS;
  return {
    modelId: typeof r.modelId === "string" && r.modelId ? r.modelId : fallback.modelId,
    endpoint: typeof r.endpoint === "string" && r.endpoint ? r.endpoint : fallback.endpoint,
    provider: coerceProvider(r.provider),
    contextLimit,
    // Never let the output cap exceed the context window itself.
    maxOutputTokens: Math.min(requestedOutput, contextLimit),
  };
}

export function getQwenProfile(): QwenProfile | null {
  try {
    const config = JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
    const raw = config.qwen;
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;

    const location: QwenLocation =
      r.location === "local" || r.location === "lan" || r.location === "public"
        ? r.location
        : "local";

    const primary = parseModelConfig(r.primary, DEFAULT_PRIMARY);
    const secondary = r.secondary ? parseModelConfig(r.secondary, DEFAULT_PRIMARY) : null;

    return {
      location,
      primary,
      secondary,
      thinkingEnabled: typeof r.thinkingEnabled === "boolean" ? r.thinkingEnabled : DEFAULT_THINKING_ENABLED,
      minDecodeRate:
        typeof r.minDecodeRate === "number" && r.minDecodeRate > 0
          ? r.minDecodeRate
          : DEFAULT_MIN_DECODE_RATE,
      probeTimeoutMs:
        typeof r.probeTimeoutMs === "number" && r.probeTimeoutMs > 0
          ? r.probeTimeoutMs
          : DEFAULT_PROBE_TIMEOUT_MS,
      sampling: parseSampling(r.sampling),
    };
  } catch {
    return null;
  }
}

const configFilePath = (): string => join(homedir(), ".hivematrix", "config.json");

function readConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(configFilePath(), "utf-8"));
  } catch {
    return {};
  }
}

/** Current Flash sampling params, independent of whether a full qwen profile is
 * configured — the settings UI always has editable values (defaults if unset). */
export function getQwenSampling(): SamplingParams {
  const config = readConfig();
  const qwen = config.qwen && typeof config.qwen === "object" ? (config.qwen as Record<string, unknown>) : {};
  return parseSampling(qwen.sampling);
}

/** Validate an untrusted sampling patch against SAMPLING_BOUNDS. Rejects out-of-range
 * numbers rather than silently clamping, so the operator gets a clear error. */
export function validateSampling(
  raw: unknown,
): { ok: true; sampling: SamplingParams } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "sampling payload must be an object" };
  const r = raw as Record<string, unknown>;
  const base = getQwenSampling();
  const out: SamplingParams = { ...base };
  for (const key of Object.keys(SAMPLING_BOUNDS) as (keyof SamplingParams)[]) {
    if (r[key] === undefined) continue;
    const v = r[key];
    const b = SAMPLING_BOUNDS[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < b.min || v > b.max) {
      return { ok: false, error: `${key} must be a number in [${b.min}, ${b.max}]` };
    }
    out[key] = b.step >= 1 ? Math.round(v) : v; // step >= 1 ⇒ integer param
  }
  return { ok: true, sampling: out };
}

/** Persist Flash sampling params (merged into config.qwen.sampling, atomic). */
export function setQwenSampling(sampling: SamplingParams): SamplingParams {
  const config = readConfig();
  const qwen = config.qwen && typeof config.qwen === "object" ? (config.qwen as Record<string, unknown>) : {};
  qwen.sampling = sampling;
  config.qwen = qwen;
  writeJsonAtomic(configFilePath(), config);
  return sampling;
}

export function isQwenEndpointLocal(endpoint: string): boolean {
  try {
    const url = new URL(endpoint.trim());
    const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return h === "localhost" || h === "127.0.0.1" || h === "::1";
  } catch {
    return false;
  }
}
