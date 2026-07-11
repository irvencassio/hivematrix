/**
 * Observability time-series + cache rollups for the dashboard.
 *
 * Buckets the normalized `task_telemetry` rows (see contracts.ts) into a
 * continuous time axis (5-minute for 1h, hourly for 24h, daily for 7d/30d)
 * split by provider, so one set of charts covers both executors uniformly
 * (Claude / Codex). Also summarizes prompt-cache usage per provider.
 *
 * Buckets are computed in LOCAL time (strftime …,'localtime') so the axis lines
 * up with the operator's clock; the cutoff comparison stays on the raw UTC ISO
 * string the rows are stored with. All local — nothing leaves the Mac.
 */

import { getDb } from "@/lib/db";
import { percentile, netCacheBenefitTokens } from "./contracts";

export type SeriesWindow = "1h" | "24h" | "7d" | "30d";

export interface ProviderCell {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

export interface SeriesPoint {
  /**
   * Bucket label, local time: "YYYY-MM-DDTHH:MM" (5-min, 1h window),
   * "YYYY-MM-DDTHH" (hour, 24h window), or "YYYY-MM-DD" (day, 7d/30d window).
   */
  t: string;
  byProvider: Record<string, ProviderCell>;
}

export interface CacheRow {
  provider: string;
  /** Does this provider report per-run prompt-cache tokens in task_telemetry?
   * (Anthropic/Codex do; local engines don't — their cache signal is a LIVE
   * process metric, surfaced separately in `localEngineCache` below.) */
  supported: boolean;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Split of cacheCreationTokens by TTL tier. Null when unknown for every
   * row in this window (pre-migration data, or a provider that doesn't
   * report the split) — see contracts.ts's cache-write-split convention. */
  cacheCreate5mTokens: number | null;
  cacheCreate1hTokens: number | null;
  /** cacheReadTokens / inputTokens — input already includes cached reads. */
  hitRatePct: number | null;
  /** Equivalent base-input-tokens saved by caching, net of the write premium.
   * See contracts.netCacheBenefitTokens — null when the 5m/1h split is unknown. */
  netBenefitTokens: number | null;
}

export interface SeriesProviderTotal {
  key: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

/** Per-model window totals — the byProvider rollup's sibling, one row per model id. */
export interface SeriesModelTotal {
  model: string;
  provider: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  /** Average tokens/sec across this model's runs in the window. */
  tokensPerSec: number | null;
}

export interface ObservabilitySeries {
  window: SeriesWindow;
  unit: "minute" | "hour" | "day";
  providers: string[];
  points: SeriesPoint[];
  cache: CacheRow[];
  /** Per-model breakdown, window-scoped, busiest model first. */
  models: SeriesModelTotal[];
  totals: {
    runs: number;
    tokens: { input: number; output: number; total: number };
    costUsd: number | null;
    byProvider: SeriesProviderTotal[];
  };
}

// Which providers report per-run prompt-cache tokens in task_telemetry.
const CACHE_SUPPORTED = new Set(["anthropic", "openai-codex"]);

interface WindowSpec {
  unit: "minute" | "hour" | "day";
  count: number;
  stepMs: number;
  cutoffMs: number;
  /**
   * SQL expression (referencing `createdAt`) that yields this bucket's local-
   * time label. Not a bare strftime FORMAT string — the 5-minute bucket needs
   * a compound expression (strftime has no native "floor to 5 minutes"), so
   * every window carries a full expression for uniformity.
   */
  bucketExpr: string;
}

// 1h uses 5-minute buckets (12 points), not the 1-minute buckets a general
// dashboard would use: HiveMatrix task runs are minutes apart, so 60
// one-minute buckets would read as ~95% empty noise. 24h/7d/30d target the
// same "~dozens of points" density at hour/day granularity.
const MINUTE_BUCKET_SIZE = 5;

function specFor(window: SeriesWindow): WindowSpec {
  const MIN = 60_000, HOUR = 3600_000, DAY = 86400_000;
  if (window === "1h") {
    return {
      unit: "minute",
      count: 60 / MINUTE_BUCKET_SIZE,
      stepMs: MINUTE_BUCKET_SIZE * MIN,
      cutoffMs: HOUR,
      // "YYYY-MM-DDTHH:" || the minute floored to the nearest 5 — must
      // byte-match bucketLabel()'s JS-side minute formatting exactly, or the
      // axis join below silently drops every row into "outside the axis".
      bucketExpr:
        `strftime('%Y-%m-%dT%H:', createdAt, 'localtime') || printf('%02d', (CAST(strftime('%M', createdAt, 'localtime') AS INTEGER) / ${MINUTE_BUCKET_SIZE}) * ${MINUTE_BUCKET_SIZE})`,
    };
  }
  if (window === "24h") return { unit: "hour", count: 24, stepMs: HOUR, cutoffMs: 24 * HOUR, bucketExpr: "strftime('%Y-%m-%dT%H', createdAt, 'localtime')" };
  if (window === "30d") return { unit: "day", count: 30, stepMs: DAY, cutoffMs: 30 * DAY, bucketExpr: "strftime('%Y-%m-%d', createdAt, 'localtime')" };
  return { unit: "day", count: 7, stepMs: DAY, cutoffMs: 7 * DAY, bucketExpr: "strftime('%Y-%m-%d', createdAt, 'localtime')" };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local-time bucket label — MUST byte-match the SQL bucketExpr's output for the same unit. */
function bucketLabel(d: Date, unit: "minute" | "hour" | "day"): string {
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (unit === "minute") {
    const flooredMin = Math.floor(d.getMinutes() / MINUTE_BUCKET_SIZE) * MINUTE_BUCKET_SIZE;
    return `${base}T${pad(d.getHours())}:${pad(flooredMin)}`;
  }
  return unit === "hour" ? `${base}T${pad(d.getHours())}` : base;
}

/** Continuous ascending axis of bucket labels ending at the current bucket. */
function axis(spec: WindowSpec): string[] {
  const now = new Date();
  const cur = new Date(now);
  if (spec.unit === "minute") cur.setMinutes(Math.floor(cur.getMinutes() / MINUTE_BUCKET_SIZE) * MINUTE_BUCKET_SIZE, 0, 0);
  else if (spec.unit === "hour") cur.setMinutes(0, 0, 0);
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

export async function observabilitySeries(window: SeriesWindow = "7d"): Promise<ObservabilitySeries> {
  const spec = specFor(window);
  const db = getDb();
  const cutoffIso = new Date(Date.now() - spec.cutoffMs).toISOString();

  // Bucketed (chart) rows.
  const bucketRows = db
    .prepare(
      `SELECT ${spec.bucketExpr} AS bucket, provider,
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

  // Per-provider window totals (cache + headline cards). cacheCreate5m/1h use
  // a bare (non-COALESCE'd) SUM: SQLite's SUM ignores individual NULLs but
  // returns NULL only when EVERY row in the group is NULL — exactly "unknown
  // for this whole provider in this window" (pre-migration data, or a
  // provider that never reports the split), never a fake 0.
  const provRows = db
    .prepare(
      `SELECT provider,
        COUNT(*) AS runs,
        COALESCE(SUM(inputTokens),0) AS inputTokens,
        COALESCE(SUM(outputTokens),0) AS outputTokens,
        COALESCE(SUM(cacheReadTokens),0) AS cacheReadTokens,
        COALESCE(SUM(cacheCreationTokens),0) AS cacheCreationTokens,
        SUM(cacheCreate5mTokens) AS cacheCreate5mTokens,
        SUM(cacheCreate1hTokens) AS cacheCreate1hTokens,
        SUM(costUsd) AS costUsd
       FROM task_telemetry
       WHERE createdAt >= ?
       GROUP BY provider`,
    )
    .all(cutoffIso) as Array<Record<string, unknown>>;

  // Per-model window rows, raw (not pre-aggregated) — p50/p95 latency needs the
  // individual values, and SQLite has no built-in percentile function. Volume
  // here is one row per task-run, small enough to aggregate in JS.
  const modelRawRows = db
    .prepare(
      `SELECT model, provider, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens,
        costUsd, latencyMs, tokensPerSec
       FROM task_telemetry
       WHERE createdAt >= ?`,
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
    const cacheCreate5mTokens = r.cacheCreate5mTokens == null ? null : Number(r.cacheCreate5mTokens);
    const cacheCreate1hTokens = r.cacheCreate1hTokens == null ? null : Number(r.cacheCreate1hTokens);
    cache.push({
      provider,
      supported,
      inputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      cacheCreate5mTokens,
      cacheCreate1hTokens,
      hitRatePct: supported && inputTokens > 0 ? Math.round((cacheReadTokens / inputTokens) * 1000) / 10 : null,
      netBenefitTokens: netCacheBenefitTokens({ cacheReadTokens, cacheCreate5mTokens, cacheCreate1hTokens }),
    });
    const costUsd = r.costUsd == null ? null : Number(r.costUsd);
    byProvider.push({ key: provider, runs, inputTokens, outputTokens, costUsd });
    totalIn += inputTokens; totalOut += outputTokens; totalRuns += runs;
    if (costUsd != null) { totalCost += costUsd; totalCostSeen = true; }
  }
  cache.sort((a, b) => b.cacheReadTokens - a.cacheReadTokens);
  byProvider.sort((a, b) => b.runs - a.runs);

  // Group the raw per-run rows by model id (provider is carried along, taken
  // from the first row in the group — a model id maps to exactly one provider
  // in practice, since it's derived once at write time).
  const modelGroups = new Map<string, { provider: string; rows: Array<Record<string, unknown>> }>();
  for (const r of modelRawRows) {
    const model = String(r.model);
    const g = modelGroups.get(model) ?? { provider: String(r.provider), rows: [] };
    g.rows.push(r);
    modelGroups.set(model, g);
  }
  const models: SeriesModelTotal[] = [...modelGroups.entries()]
    .map(([model, g]) => {
      const rows = g.rows;
      const costs = rows.map((r) => r.costUsd).filter((v): v is number => v != null).map(Number);
      const latencies = rows.map((r) => r.latencyMs).filter((v): v is number => v != null).map(Number);
      const tps = rows.map((r) => r.tokensPerSec).filter((v): v is number => v != null).map(Number);
      return {
        model,
        provider: g.provider,
        runs: rows.length,
        inputTokens: rows.reduce((a, r) => a + num(r.inputTokens), 0),
        outputTokens: rows.reduce((a, r) => a + num(r.outputTokens), 0),
        cacheReadTokens: rows.reduce((a, r) => a + num(r.cacheReadTokens), 0),
        cacheCreationTokens: rows.reduce((a, r) => a + num(r.cacheCreationTokens), 0),
        costUsd: costs.length ? Math.round(costs.reduce((a, b) => a + b, 0) * 1e6) / 1e6 : null,
        latencyP50Ms: percentile(latencies, 50),
        latencyP95Ms: percentile(latencies, 95),
        tokensPerSec: tps.length ? Math.round((tps.reduce((a, b) => a + b, 0) / tps.length) * 10) / 10 : null,
      };
    })
    .sort((a, b) => b.runs - a.runs);

  return {
    window,
    unit: spec.unit,
    providers: [...providers].sort(),
    points,
    cache,
    models,
    totals: {
      runs: totalRuns,
      tokens: { input: totalIn, output: totalOut, total: totalIn + totalOut },
      costUsd: totalCostSeen ? Math.round(totalCost * 1e6) / 1e6 : null,
      byProvider,
    },
  };
}
