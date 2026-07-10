import test from "node:test";
import assert from "node:assert/strict";
import { scrapeTierMetrics, getTierMetricsCached, deltaTierMetrics } from "./metrics";

// A trimmed real rapid-mlx /metrics body (see the exact metric names this
// parser must handle — captured from a live scrape during development).
const SAMPLE_METRICS = `
# HELP rapid_mlx_build_info Build info as constant 1 (version/model carried in labels).
# TYPE rapid_mlx_build_info gauge
rapid_mlx_build_info{version="0.9.13",model="mlx-community/Qwen3.6-35B-A3B-4bit"} 1
# HELP rapid_mlx_kv_cache_dtype Effective KV cache dtype.
# TYPE rapid_mlx_kv_cache_dtype gauge
rapid_mlx_kv_cache_dtype{dtype="bf16"} 1
rapid_mlx_kv_cache_dtype{dtype="int8"} 0
rapid_mlx_kv_cache_dtype{dtype="int4"} 0
# HELP rapid_mlx_turboquant_mode Active TurboQuant compression mode.
# TYPE rapid_mlx_turboquant_mode gauge
rapid_mlx_turboquant_mode{mode="disabled"} 0
rapid_mlx_turboquant_mode{mode="v4"} 0
rapid_mlx_turboquant_mode{mode="k8v4"} 1
# HELP rapid_mlx_prompt_tokens_total Cumulative prompt tokens consumed across all requests.
# TYPE rapid_mlx_prompt_tokens_total counter
rapid_mlx_prompt_tokens_total 6111943
# HELP rapid_mlx_completion_tokens_total Cumulative completion tokens generated across all requests.
# TYPE rapid_mlx_completion_tokens_total counter
rapid_mlx_completion_tokens_total 183563
rapid_mlx_requests_running 1
rapid_mlx_requests_waiting 0
rapid_mlx_prefix_cache_hits_total 4200
rapid_mlx_prefix_cache_misses_total 800
rapid_mlx_prefix_cache_tokens_saved_total 950000
rapid_mlx_prefix_cache_current_bytes 1073741824
rapid_mlx_prefix_cache_cap_bytes 4294967296
rapid_mlx_prefix_cache_evictions_total 12
rapid_mlx_prefix_cache_pressure_evictions_total 3
rapid_mlx_uptime_seconds 86412.5
`;

test("scrapeTierMetrics parses the real rapid-mlx exposition format, including 1-of-N gauge decoding", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url: string | URL | Request) => {
      assert.equal(String(url), "http://127.0.0.1:8000/metrics");
      return new Response(SAMPLE_METRICS, { status: 200 });
    }) as typeof fetch;

    const m = await scrapeTierMetrics(8000);
    assert.ok(m, "metrics must parse successfully");
    assert.equal(m!.port, 8000);
    assert.equal(m!.promptTokensTotal, 6111943);
    assert.equal(m!.completionTokensTotal, 183563);
    assert.equal(m!.requestsRunning, 1);
    assert.equal(m!.requestsWaiting, 0);
    assert.equal(m!.prefixCacheHitsTotal, 4200);
    assert.equal(m!.prefixCacheMissesTotal, 800);
    assert.equal(m!.prefixCacheTokensSavedTotal, 950000);
    assert.equal(m!.prefixCacheCurrentBytes, 1073741824);
    assert.equal(m!.prefixCacheCapBytes, 4294967296);
    assert.equal(m!.prefixCacheEvictionsTotal, 12);
    assert.equal(m!.prefixCachePressureEvictionsTotal, 3);
    assert.equal(m!.uptimeSeconds, 86412.5);
    // 1-of-N gauge decoding: only the label whose value is 1 is the active one.
    assert.equal(m!.kvCacheDtype, "bf16");
    assert.equal(m!.turboquantMode, "k8v4");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scrapeTierMetrics returns null on connection failure, non-200, and malformed body — never a fabricated zero", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch;
    assert.equal(await scrapeTierMetrics(8000), null, "engine unreachable → null");

    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
    assert.equal(await scrapeTierMetrics(8000), null, "non-rapid-mlx server (404) → null");

    // A malformed/empty body parses to all-null fields, not a thrown error —
    // the parser tolerates unknown lines rather than failing the whole scrape.
    globalThis.fetch = (async () => new Response("not prometheus text at all\n:::garbage:::", { status: 200 })) as typeof fetch;
    const m = await scrapeTierMetrics(8000);
    assert.ok(m, "a 200 with an unparseable body still returns a struct, all fields null");
    assert.equal(m!.promptTokensTotal, null);
    assert.equal(m!.kvCacheDtype, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getTierMetricsCached reuses a scrape within the TTL and re-scrapes after it expires", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(SAMPLE_METRICS, { status: 200 });
    }) as typeof fetch;

    const a = await getTierMetricsCached(9001, 50);
    const b = await getTierMetricsCached(9001, 50);
    assert.equal(calls, 1, "second call within the TTL window must reuse the cached scrape");
    assert.ok(a && b);

    await new Promise((r) => setTimeout(r, 60));
    await getTierMetricsCached(9001, 50);
    assert.equal(calls, 2, "a call after the TTL expires must re-scrape");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deltaTierMetrics computes a rate between two scrapes and discards it across an engine restart", () => {
  const base = {
    port: 8000, scrapedAtMs: 1000, uptimeSeconds: 100,
    promptTokensTotal: 1000, completionTokensTotal: 200,
    requestsRunning: 0, requestsWaiting: 0,
    prefixCacheHitsTotal: 500, prefixCacheMissesTotal: 100, prefixCacheTokensSavedTotal: 90000,
    prefixCacheCurrentBytes: 0, prefixCacheCapBytes: 0, prefixCacheEvictionsTotal: 0, prefixCachePressureEvictionsTotal: 0,
    kvCacheDtype: "bf16", turboquantMode: "k8v4",
  };
  const later = { ...base, scrapedAtMs: 2000, uptimeSeconds: 200, promptTokensTotal: 1500, prefixCacheHitsTotal: 600, prefixCacheTokensSavedTotal: 95000 };

  const delta = deltaTierMetrics(base, later);
  assert.ok(delta);
  assert.equal(delta!.intervalMs, 1000);
  assert.equal(delta!.promptTokens, 500);
  assert.equal(delta!.prefixCacheHits, 100);
  assert.equal(delta!.prefixCacheTokensSaved, 5000);

  // Engine restarted between scrapes: uptime went backwards → counters reset
  // → no valid delta (a naive subtraction would show a huge negative "rate").
  const restarted = { ...base, scrapedAtMs: 3000, uptimeSeconds: 5, promptTokensTotal: 40 };
  assert.equal(deltaTierMetrics(later, restarted), null);
});
