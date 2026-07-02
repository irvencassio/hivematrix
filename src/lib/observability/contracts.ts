/**
 * Observability — normalized per-run telemetry across all three executors.
 *
 * The three runners report different amounts (Claude: full tokens+cost; Qwen:
 * tokens, no cost because it's on-device; Codex: tokens recovered from its
 * session log, no cost). This module is the single normalizer: raw run data in,
 * one `TaskTelemetry` record out, using the OpenTelemetry GenAI vocabulary so
 * the data is standards-portable.
 *
 * THE CORRECTNESS RULE: never fake a 0. When a signal is genuinely unavailable
 * (e.g. Codex tokens before recovery), the field is `null` — the UI shows "—"
 * and rollups exclude it. A fake 0 would silently corrupt every total.
 */

export type Provider = "anthropic" | "openai-codex" | "local-qwen" | "other";

/** Map a model id to its provider. Codex models are prefixed `codex:`. */
export function providerForModel(model: string | null | undefined): Provider {
  const m = (model ?? "").toLowerCase().trim();
  if (!m) return "other";
  if (/^(codex|chatgpt)/.test(m) || /^(gpt|o[0-9])/.test(m)) return "openai-codex";
  if (/^(claude|opus|sonnet|haiku)/.test(m)) return "anthropic";
  if (/(qwen|mistral|llama|mlx|local|deepseek|gemma|phi|nan)/.test(m)) return "local-qwen";
  return "other";
}

export function isLocalProvider(p: Provider): boolean {
  return p === "local-qwen";
}

/** Raw, per-run inputs handed to the normalizer (any field may be missing). */
export interface RunTelemetryInput {
  taskId: string;
  runIndex: number;
  model: string | null | undefined;
  role?: string | null;
  connectivity?: string | null;
  status: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheCreationTokens?: number | null;
  reasoningTokens?: number | null;
  /** Provider-reported cost only. Local + Codex stay null (not 0). */
  costUsd?: number | null;
  turns?: number | null;
  toolCalls?: number | null;
  startedAtMs?: number | null;
  completedAtMs?: number | null;
  firstTokenAtMs?: number | null;
  directiveId?: string | null;
  runId?: string | null;
  proverType?: string | null;
  project?: string | null;
  createdAt?: string;
}

/** The normalized record (one row per task-run). gen_ai.* fields are named for portability. */
export interface TaskTelemetry {
  taskId: string;
  runIndex: number;
  provider: Provider;
  model: string;
  role: string | null;
  connectivity: string | null;
  status: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  tokensPerSec: number | null;
  latencyMs: number | null;
  ttftMs: number | null;
  turns: number | null;
  toolCalls: number | null;
  costUsd: number | null;
  directiveId: string | null;
  runId: string | null;
  proverType: string | null;
  project: string | null;
  createdAt: string;
}

function numOrNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Pure: raw run data → one normalized TaskTelemetry record. */
export function normalizeRun(input: RunTelemetryInput): TaskTelemetry {
  const provider = providerForModel(input.model);
  const model = (input.model ?? "").trim() || "unknown";

  let inTok = numOrNull(input.inputTokens);
  let outTok = numOrNull(input.outputTokens);
  let cacheRead = numOrNull(input.cacheReadTokens);
  let cacheCreate = numOrNull(input.cacheCreationTokens);
  let reasoning = numOrNull(input.reasoningTokens);

  // Codex reports 0/0 when usage is unavailable (raw stdout, no usage object).
  // Treat that as "unavailable" → null, so it never pollutes token totals.
  if (provider === "openai-codex" && (inTok ?? 0) === 0 && (outTok ?? 0) === 0) {
    inTok = null; outTok = null; cacheRead = null; cacheCreate = null; reasoning = null;
  }

  const anyTokens = inTok != null || outTok != null;
  const totalTokens = anyTokens ? (inTok ?? 0) + (outTok ?? 0) + (cacheRead ?? 0) + (cacheCreate ?? 0) : null;

  const latencyMs =
    input.completedAtMs != null && input.startedAtMs != null
      ? Math.max(0, input.completedAtMs - input.startedAtMs)
      : null;
  const ttftMs =
    input.firstTokenAtMs != null && input.startedAtMs != null
      ? Math.max(0, input.firstTokenAtMs - input.startedAtMs)
      : null;

  const tokensPerSec =
    outTok != null && latencyMs != null && latencyMs > 0
      ? Math.round((outTok / (latencyMs / 1000)) * 10) / 10
      : null;

  // Cost: provider-reported only. Local is free (null, not 0); Codex isn't
  // reported (null). Anthropic carries the real number.
  const reportedCost = numOrNull(input.costUsd);
  const costUsd = isLocalProvider(provider) || provider === "openai-codex"
    ? null
    : (reportedCost != null && reportedCost > 0 ? reportedCost : null);

  return {
    taskId: input.taskId,
    runIndex: input.runIndex,
    provider,
    model,
    role: input.role ?? null,
    connectivity: input.connectivity ?? null,
    status: input.status,
    inputTokens: inTok,
    outputTokens: outTok,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreate,
    reasoningTokens: reasoning,
    totalTokens,
    tokensPerSec,
    latencyMs,
    ttftMs,
    turns: numOrNull(input.turns),
    toolCalls: numOrNull(input.toolCalls),
    costUsd,
    directiveId: input.directiveId ?? null,
    runId: input.runId ?? null,
    proverType: input.proverType ?? null,
    project: input.project ?? null,
    createdAt: input.createdAt ?? "",
  };
}

// --- Totals / rollups ---------------------------------------------------------

export interface ProviderTotals {
  key: string;            // provider or model id
  runs: number;
  succeeded: number;
  failed: number;
  /** null when no run in the group reported token data (e.g. Codex with failed session-log recovery). */
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null; // null when no provider reported cost
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  avgTokensPerSec: number | null;
}

export interface ObservabilityTotals {
  runs: number;
  byProvider: ProviderTotals[];
  byModel: ProviderTotals[];
  split: { local: number; frontier: number };
  tokens: { input: number; output: number; total: number };
  costUsd: number | null;
}

/** Nearest-rank percentile over a numeric array (returns null when empty). */
export function percentile(values: number[], p: number): number | null {
  const xs = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const rank = Math.ceil((p / 100) * xs.length);
  return xs[Math.min(xs.length - 1, Math.max(0, rank - 1))];
}

function totalsFor(key: string, rows: TaskTelemetry[]): ProviderTotals {
  const latencies = rows.map((r) => r.latencyMs).filter((v): v is number => v != null);
  const tps = rows.map((r) => r.tokensPerSec).filter((v): v is number => v != null);
  const costs = rows.map((r) => r.costUsd).filter((v): v is number => v != null);
  // Sum only rows that reported a value; return null (not 0) when none did.
  // This preserves the "never fake a 0" rule for Codex with unavailable tokens.
  const nullableSum = (f: (r: TaskTelemetry) => number | null): number | null => {
    const withValues = rows.filter((r) => f(r) != null);
    return withValues.length ? withValues.reduce((acc, r) => acc + (f(r) ?? 0), 0) : null;
  };
  return {
    key,
    runs: rows.length,
    succeeded: rows.filter((r) => r.status === "done" || r.status === "review").length,
    failed: rows.filter((r) => r.status === "failed").length,
    inputTokens: nullableSum((r) => r.inputTokens),
    outputTokens: nullableSum((r) => r.outputTokens),
    totalTokens: nullableSum((r) => r.totalTokens),
    costUsd: costs.length ? Math.round(costs.reduce((a, b) => a + b, 0) * 1e6) / 1e6 : null,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    avgTokensPerSec: tps.length ? Math.round((tps.reduce((a, b) => a + b, 0) / tps.length) * 10) / 10 : null,
  };
}

/** Aggregate normalized rows into provider/model totals + a local/frontier split. */
export function summarizeTelemetry(rows: TaskTelemetry[]): ObservabilityTotals {
  const byProviderMap = new Map<string, TaskTelemetry[]>();
  const byModelMap = new Map<string, TaskTelemetry[]>();
  for (const r of rows) {
    (byProviderMap.get(r.provider) ?? byProviderMap.set(r.provider, []).get(r.provider)!).push(r);
    (byModelMap.get(r.model) ?? byModelMap.set(r.model, []).get(r.model)!).push(r);
  }
  const byProvider = [...byProviderMap.entries()].map(([k, rs]) => totalsFor(k, rs)).sort((a, b) => b.runs - a.runs);
  const byModel = [...byModelMap.entries()].map(([k, rs]) => totalsFor(k, rs)).sort((a, b) => b.runs - a.runs);
  const local = rows.filter((r) => isLocalProvider(r.provider)).length;
  const allCost = rows.map((r) => r.costUsd).filter((v): v is number => v != null);
  return {
    runs: rows.length,
    byProvider,
    byModel,
    split: { local, frontier: rows.length - local },
    tokens: {
      input: rows.reduce((a, r) => a + (r.inputTokens ?? 0), 0),
      output: rows.reduce((a, r) => a + (r.outputTokens ?? 0), 0),
      total: rows.reduce((a, r) => a + (r.totalTokens ?? 0), 0),
    },
    costUsd: allCost.length ? Math.round(allCost.reduce((a, b) => a + b, 0) * 1e6) / 1e6 : null,
  };
}
