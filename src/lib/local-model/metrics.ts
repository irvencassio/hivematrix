/**
 * Live KV/prefix-cache telemetry for the rapid-mlx local engine.
 *
 * Unlike task_telemetry (one row per completed run, aggregated over a time
 * window), this is a snapshot of the RUNNING process's own counters — rapid-mlx
 * exposes a standard Prometheus /metrics endpoint per tier (one per port; each
 * tier is its own process). There is no npm Prometheus client dependency here:
 * the exposition format is ~30 lines to parse and pulling in a client for that
 * would be the wrong trade.
 *
 * Only rapid-mlx is scraped — lmstudio/ollama don't expose this endpoint (see
 * LocalEngineKind in local-engine.ts). A local engine is frequently not
 * running at all, so every failure mode (ECONNREFUSED, timeout, 404, a
 * malformed body) resolves to `null`, never a fabricated zero.
 */

const METRICS_TIMEOUT_MS = 1000;
const CACHE_TTL_MS = 4000;

interface PromSample {
  labels: Record<string, string>;
  value: number;
}

/**
 * Minimal Prometheus text-exposition-format parser. Handles `# HELP`/`# TYPE`
 * comments, bare gauges/counters, and labelled series (`name{k="v"} 1.0`).
 * Ignores anything it can't parse rather than throwing — a forward-compatible
 * new metric line must not break every other metric on the same scrape.
 */
function parsePrometheusText(text: string): Map<string, PromSample[]> {
  const out = new Map<string, PromSample[]>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+(-?[0-9.eE+-]+)\s*$/);
    if (!m) continue;
    const name = m[1];
    const labelsRaw = m[3] ?? "";
    const value = Number(m[4]);
    if (!Number.isFinite(value)) continue;
    const labels: Record<string, string> = {};
    if (labelsRaw) {
      // Label values are double-quoted and may contain escaped quotes/backslashes.
      const labelRe = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;
      let lm: RegExpExecArray | null;
      while ((lm = labelRe.exec(labelsRaw))) {
        labels[lm[1]] = lm[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    }
    const list = out.get(name) ?? [];
    list.push({ labels, value });
    out.set(name, list);
  }
  return out;
}

function scalar(samples: Map<string, PromSample[]>, name: string): number | null {
  const s = samples.get(name);
  return s && s.length ? s[0].value : null;
}

/** Decode a 1-of-N gauge (one series per label, value 1 for the active one). */
function activeLabel(samples: Map<string, PromSample[]>, name: string, labelKey: string): string | null {
  const s = samples.get(name);
  if (!s) return null;
  const active = s.find((row) => row.value === 1);
  return active ? (active.labels[labelKey] ?? null) : null;
}

export interface RapidMlxTierMetrics {
  port: number;
  scrapedAtMs: number;
  uptimeSeconds: number | null;
  promptTokensTotal: number | null;
  completionTokensTotal: number | null;
  requestsRunning: number | null;
  requestsWaiting: number | null;
  prefixCacheHitsTotal: number | null;
  prefixCacheMissesTotal: number | null;
  prefixCacheTokensSavedTotal: number | null;
  prefixCacheCurrentBytes: number | null;
  prefixCacheCapBytes: number | null;
  prefixCacheEvictionsTotal: number | null;
  prefixCachePressureEvictionsTotal: number | null;
  kvCacheDtype: string | null;
  turboquantMode: string | null;
}

function parseTierMetrics(port: number, text: string): RapidMlxTierMetrics {
  const s = parsePrometheusText(text);
  return {
    port,
    scrapedAtMs: Date.now(),
    uptimeSeconds: scalar(s, "rapid_mlx_uptime_seconds"),
    promptTokensTotal: scalar(s, "rapid_mlx_prompt_tokens_total"),
    completionTokensTotal: scalar(s, "rapid_mlx_completion_tokens_total"),
    requestsRunning: scalar(s, "rapid_mlx_requests_running"),
    requestsWaiting: scalar(s, "rapid_mlx_requests_waiting"),
    prefixCacheHitsTotal: scalar(s, "rapid_mlx_prefix_cache_hits_total"),
    prefixCacheMissesTotal: scalar(s, "rapid_mlx_prefix_cache_misses_total"),
    prefixCacheTokensSavedTotal: scalar(s, "rapid_mlx_prefix_cache_tokens_saved_total"),
    prefixCacheCurrentBytes: scalar(s, "rapid_mlx_prefix_cache_current_bytes"),
    prefixCacheCapBytes: scalar(s, "rapid_mlx_prefix_cache_cap_bytes"),
    prefixCacheEvictionsTotal: scalar(s, "rapid_mlx_prefix_cache_evictions_total"),
    prefixCachePressureEvictionsTotal: scalar(s, "rapid_mlx_prefix_cache_pressure_evictions_total"),
    kvCacheDtype: activeLabel(s, "rapid_mlx_kv_cache_dtype", "dtype"),
    turboquantMode: activeLabel(s, "rapid_mlx_turboquant_mode", "mode"),
  };
}

/** One live /metrics scrape of a rapid-mlx tier. Null on any failure — never a fabricated zero. */
export async function scrapeTierMetrics(port: number, timeoutMs = METRICS_TIMEOUT_MS): Promise<RapidMlxTierMetrics | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/metrics`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const text = await res.text();
    return parseTierMetrics(port, text);
  } catch {
    return null; // ECONNREFUSED, timeout, DNS — the engine simply isn't up
  }
}

const g = globalThis as typeof globalThis & {
  __hiveTierMetricsCache?: Map<number, { at: number; result: RapidMlxTierMetrics | null }>;
};

/**
 * TTL-cached scrape — called from the observability HTTP handler, which must
 * never block a dashboard render on a live network round-trip to a process
 * that may not be running. A short TTL (a few seconds) means a burst of
 * refreshes within the same window reuses one scrape instead of re-hitting
 * the engine per request, without needing a background poller for a
 * single-operator local app.
 */
export async function getTierMetricsCached(port: number, ttlMs = CACHE_TTL_MS): Promise<RapidMlxTierMetrics | null> {
  const cache = (g.__hiveTierMetricsCache ??= new Map());
  const cached = cache.get(port);
  if (cached && Date.now() - cached.at < ttlMs) return cached.result;
  const result = await scrapeTierMetrics(port);
  cache.set(port, { at: Date.now(), result });
  return result;
}

export interface TierMetricsDelta {
  port: number;
  intervalMs: number;
  prefixCacheHits: number;
  prefixCacheMisses: number;
  prefixCacheTokensSaved: number;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Delta between two scrapes of the same tier, for a rate/throughput view.
 * Counters are cumulative since process start — a raw scrape is not a rate.
 * Returns null when a delta isn't meaningful: no prior snapshot, or the
 * engine restarted between scrapes (uptimeSeconds went backwards, so every
 * counter reset to zero and a naive subtraction would show a huge negative
 * "rate").
 */
export function deltaTierMetrics(prev: RapidMlxTierMetrics, next: RapidMlxTierMetrics): TierMetricsDelta | null {
  if (prev.port !== next.port) return null;
  if (prev.uptimeSeconds != null && next.uptimeSeconds != null && next.uptimeSeconds < prev.uptimeSeconds) {
    return null; // engine restarted between scrapes — counters reset, no valid delta
  }
  const d = (a: number | null, b: number | null) => (a != null && b != null ? Math.max(0, b - a) : 0);
  return {
    port: next.port,
    intervalMs: next.scrapedAtMs - prev.scrapedAtMs,
    prefixCacheHits: d(prev.prefixCacheHitsTotal, next.prefixCacheHitsTotal),
    prefixCacheMisses: d(prev.prefixCacheMissesTotal, next.prefixCacheMissesTotal),
    prefixCacheTokensSaved: d(prev.prefixCacheTokensSavedTotal, next.prefixCacheTokensSavedTotal),
    promptTokens: d(prev.promptTokensTotal, next.promptTokensTotal),
    completionTokens: d(prev.completionTokensTotal, next.completionTokensTotal),
  };
}
