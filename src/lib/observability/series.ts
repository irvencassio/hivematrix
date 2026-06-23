/**
 * Observability time-series + cache rollups for the dashboard.
 *
 * Buckets the normalized `task_telemetry` rows (see contracts.ts) into a
 * continuous time axis (hourly for 24h, daily for 7d/30d) split by provider, so
 * one set of charts covers all three executors uniformly (Claude / Codex / local
 * Qwen). Also summarizes prompt-cache usage per provider.
 *
 * Buckets are computed in LOCAL time (strftime …,'localtime') so the axis lines
 * up with the operator's clock; the cutoff comparison stays on the raw UTC ISO
 * string the rows are stored with. All local — nothing leaves the Mac.
 */

import { getDb } from "@/lib/db";

export type SeriesWindow = "24h" | "7d" | "30d";

export interface ProviderCell {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

export interface SeriesPoint {
  /** Bucket label, local time: "YYYY-MM-DDTHH" (hour) or "YYYY-MM-DD" (day). */
  t: string;
  byProvider: Record<string, ProviderCell>;
}

export interface CacheRow {
  provider: string;
  /** Does this provider expose prompt caching at all? (local Qwen does not.) */
  supported: boolean;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** cacheReadTokens / inputTokens — input already includes cached reads. */
  hitRatePct: number | null;
}

export interface SeriesProviderTotal {
  key: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

export interface ObservabilitySeries {
  window: SeriesWindow;
  unit: "hour" | "day";
  providers: string[];
  points: SeriesPoint[];
  cache: CacheRow[];
  totals: {
    runs: number;
    tokens: { input: number; output: number; total: number };
    costUsd: number | null;
    byProvider: SeriesProviderTotal[];
  };
}

const CACHE_SUPPORTED = new Set(["anthropic", "openai-codex"]);

interface WindowSpec {
  unit: "hour" | "day";
  count: number;
  stepMs: number;
  cutoffMs: number;
  /** SQLite strftime format for the local-time bucket. */
  fmt: string;
}

function specFor(window: SeriesWindow): WindowSpec {
  const HOUR = 3600_000, DAY = 86400_000;
  if (window === "24h") return { unit: "hour", count: 24, stepMs: HOUR, cutoffMs: 24 * HOUR, fmt: "%Y-%m-%dT%H" };
  if (window === "30d") return { unit: "day", count: 30, stepMs: DAY, cutoffMs: 30 * DAY, fmt: "%Y-%m-%d" };
  return { unit: "day", count: 7, stepMs: DAY, cutoffMs: 7 * DAY, fmt: "%Y-%m-%d" };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local-time bucket label matching SQLite's strftime(…,'localtime') output. */
function bucketLabel(d: Date, unit: "hour" | "day"): string {
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return unit === "hour" ? `${base}T${pad(d.getHours())}` : base;
}

/** Continuous ascending axis of bucket labels ending at the current bucket. */
function axis(spec: WindowSpec): string[] {
  const now = new Date();
  const cur = new Date(now);
  if (spec.unit === "hour") cur.setMinutes(0, 0, 0);
  else cur.setHours(0, 0, 0, 0);
  const labels: string[] = [];
  for (let i = spec.count - 1; i >= 0; i--) {
    labels.push(bucketLabel(new Date(cur.getTime() - i * spec.stepMs), spec.unit));
  }
  return labels;
}

function emptyCell(): ProviderCell {
  return { runs: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 };
}

export function observabilitySeries(window: SeriesWindow = "7d"): ObservabilitySeries {
  const spec = specFor(window);
  const db = getDb();
  const cutoffIso = new Date(Date.now() - spec.cutoffMs).toISOString();

  // Bucketed (chart) rows.
  const bucketRows = db
    .prepare(
      `SELECT strftime('${spec.fmt}', createdAt, 'localtime') AS bucket, provider,
        COUNT(*) AS runs,
        COALESCE(SUM(inputTokens),0) AS inputTokens,
        COALESCE(SUM(outputTokens),0) AS outputTokens,
        COALESCE(SUM(cacheReadTokens),0) AS cacheReadTokens,
        COALESCE(SUM(cacheCreationTokens),0) AS cacheCreationTokens,
        COALESCE(SUM(costUsd),0) AS costUsd
       FROM task_telemetry
       WHERE createdAt >= ?
       GROUP BY bucket, provider`,
    )
    .all(cutoffIso) as Array<Record<string, unknown>>;

  // Per-provider window totals (cache + headline cards).
  const provRows = db
    .prepare(
      `SELECT provider,
        COUNT(*) AS runs,
        COALESCE(SUM(inputTokens),0) AS inputTokens,
        COALESCE(SUM(outputTokens),0) AS outputTokens,
        COALESCE(SUM(cacheReadTokens),0) AS cacheReadTokens,
        COALESCE(SUM(cacheCreationTokens),0) AS cacheCreationTokens,
        SUM(costUsd) AS costUsd
       FROM task_telemetry
       WHERE createdAt >= ?
       GROUP BY provider`,
    )
    .all(cutoffIso) as Array<Record<string, unknown>>;

  const num = (v: unknown) => (v == null ? 0 : Number(v));

  // Assemble the continuous axis with zero-filled cells.
  const labels = axis(spec);
  const byBucket = new Map<string, SeriesPoint>();
  for (const t of labels) byBucket.set(t, { t, byProvider: {} });
  const providers = new Set<string>();
  for (const r of bucketRows) {
    const t = String(r.bucket);
    const point = byBucket.get(t);
    if (!point) continue; // outside the rendered axis (clock edge) — skip
    const provider = String(r.provider);
    providers.add(provider);
    point.byProvider[provider] = {
      runs: num(r.runs),
      inputTokens: num(r.inputTokens),
      outputTokens: num(r.outputTokens),
      cacheReadTokens: num(r.cacheReadTokens),
      cacheCreationTokens: num(r.cacheCreationTokens),
      costUsd: num(r.costUsd),
    };
  }
  const points = labels.map((t) => {
    const p = byBucket.get(t)!;
    for (const prov of providers) if (!p.byProvider[prov]) p.byProvider[prov] = emptyCell();
    return p;
  });

  // Cache rows + headline totals from the per-provider sums.
  const cache: CacheRow[] = [];
  const byProvider: SeriesProviderTotal[] = [];
  let totalIn = 0, totalOut = 0, totalCost = 0, totalCostSeen = false, totalRuns = 0;
  for (const r of provRows) {
    const provider = String(r.provider);
    providers.add(provider);
    const inputTokens = num(r.inputTokens);
    const outputTokens = num(r.outputTokens);
    const cacheReadTokens = num(r.cacheReadTokens);
    const cacheCreationTokens = num(r.cacheCreationTokens);
    const runs = num(r.runs);
    const supported = CACHE_SUPPORTED.has(provider);
    cache.push({
      provider,
      supported,
      inputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      hitRatePct: supported && inputTokens > 0 ? Math.round((cacheReadTokens / inputTokens) * 1000) / 10 : null,
    });
    const costUsd = r.costUsd == null ? null : Number(r.costUsd);
    byProvider.push({ key: provider, runs, inputTokens, outputTokens, costUsd });
    totalIn += inputTokens; totalOut += outputTokens; totalRuns += runs;
    if (costUsd != null) { totalCost += costUsd; totalCostSeen = true; }
  }
  cache.sort((a, b) => b.cacheReadTokens - a.cacheReadTokens);
  byProvider.sort((a, b) => b.runs - a.runs);

  return {
    window,
    unit: spec.unit,
    providers: [...providers].sort(),
    points,
    cache,
    totals: {
      runs: totalRuns,
      tokens: { input: totalIn, output: totalOut, total: totalIn + totalOut },
      costUsd: totalCostSeen ? Math.round(totalCost * 1e6) / 1e6 : null,
      byProvider,
    },
  };
}
