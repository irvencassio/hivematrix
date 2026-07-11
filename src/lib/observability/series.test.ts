import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Isolate HOME so the DB is a fresh temp instance.
const TMP = mkdtempSync(join(tmpdir(), "hm-obs-series-test-"));
process.env.HOME = TMP;
mkdirSync(join(TMP, ".hivematrix"), { recursive: true });

const { recordTaskTelemetry } = await import("./store");
const { observabilitySeries } = await import("./series");
const { normalizeRun } = await import("./contracts");

test.after(() => rmSync(TMP, { recursive: true, force: true }));

function recordAt(createdAt: string, partial: Record<string, unknown>): void {
  recordTaskTelemetry(normalizeRun({ runIndex: 0, status: "done", createdAt, ...(partial as any) }));
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

test("series buckets across all three providers within the window", async () => {
  recordAt(hoursAgo(0), { taskId: "a", model: "claude-opus-4-8", inputTokens: 1000, outputTokens: 200, cacheReadTokens: 800, cacheCreationTokens: 150, costUsd: 0.02 });
  recordAt(hoursAgo(1), { taskId: "b", model: "codex:gpt-5.5-codex", inputTokens: 500, outputTokens: 100, cacheReadTokens: 200 });
  recordAt(hoursAgo(2), { taskId: "c", model: "qwen3-coder-30b", inputTokens: 300, outputTokens: 80 });
  recordAt(hoursAgo(40), { taskId: "old", model: "claude-opus-4-8", inputTokens: 999, outputTokens: 99, costUsd: 0.5 });

  const s = await observabilitySeries("24h");
  assert.equal(s.unit, "hour");
  assert.equal(s.points.length, 24);
  // All three providers present; the 40h-old row is excluded from totals.
  assert.deepEqual(s.providers.slice().sort(), ["anthropic", "local-qwen", "openai-codex"]);
  assert.equal(s.totals.runs, 3);
  assert.equal(s.totals.tokens.input, 1800);
  // Only Claude reports cost; the old high-cost row is outside the window.
  assert.equal(s.totals.costUsd, 0.02);
});

test("models rollup: one row per model id, tagged with its provider", async () => {
  const s = await observabilitySeries("24h");
  const byModel = Object.fromEntries(s.models.map((m) => [m.model, m]));

  assert.equal(byModel["claude-opus-4-8"].provider, "anthropic");
  assert.equal(byModel["claude-opus-4-8"].inputTokens, 1000);
  assert.equal(byModel["claude-opus-4-8"].outputTokens, 200);
  assert.equal(byModel["claude-opus-4-8"].costUsd, 0.02);

  assert.equal(byModel["codex:gpt-5.5-codex"].provider, "openai-codex");
  assert.equal(byModel["qwen3-coder-30b"].provider, "local-qwen");

  // The 40h-old claude-opus-4-8 row is outside the 24h window, so it must not
  // be double-counted into this model's runs.
  assert.equal(byModel["claude-opus-4-8"].runs, 1);
  assert.equal(s.models.length, 3);
});

test("models rollup: two distinct local models under the same provider stay distinct rows, not merged", async () => {
  recordAt(hoursAgo(0.1), { taskId: "d1", model: "qwen3.6-35b-4bit", inputTokens: 100, outputTokens: 50 });
  recordAt(hoursAgo(0.2), { taskId: "d2", model: "qwen3.6-27b-4bit", inputTokens: 60, outputTokens: 40 });

  const s = await observabilitySeries("24h");
  const byModel = Object.fromEntries(s.models.map((m) => [m.model, m]));

  assert.ok(byModel["qwen3.6-35b-4bit"], "the fast tier is its own row");
  assert.ok(byModel["qwen3.6-27b-4bit"], "the coding tier is its own row");
  assert.equal(byModel["qwen3.6-35b-4bit"].provider, "local-qwen");
  assert.equal(byModel["qwen3.6-35b-4bit"].inputTokens, 100);
  assert.equal(byModel["qwen3.6-27b-4bit"].inputTokens, 60);
  // Both tiers plus the pre-existing qwen3-coder-30b row — three distinct
  // local-qwen models, none collapsed into a single "local model" bucket.
  const localModels = s.models.filter((m) => m.provider === "local-qwen");
  assert.equal(localModels.length, 3);
});

test("cache rollup: supported providers get a hit-rate, local does not", async () => {
  const s = await observabilitySeries("24h");
  const byProv = Object.fromEntries(s.cache.map((c) => [c.provider, c]));

  // Claude: 800 cache reads out of 1000 input → 80% hit, 150 written.
  assert.equal(byProv["anthropic"].supported, true);
  assert.equal(byProv["anthropic"].hitRatePct, 80);
  assert.equal(byProv["anthropic"].cacheCreationTokens, 150);
  // No row in this test recorded a 5m/1h split → unknown for the whole
  // provider in this window, so netBenefitTokens must be null, not a fake 0.
  assert.equal(byProv["anthropic"].cacheCreate5mTokens, null);
  assert.equal(byProv["anthropic"].cacheCreate1hTokens, null);
  assert.equal(byProv["anthropic"].netBenefitTokens, null);

  // Codex: cache reads tracked, hit-rate computed, no creation split.
  assert.equal(byProv["openai-codex"].supported, true);
  assert.equal(byProv["openai-codex"].hitRatePct, 40);

  // Local engines: caching not supported → null hit-rate.
  assert.equal(byProv["local-qwen"].supported, false);
  assert.equal(byProv["local-qwen"].hitRatePct, null);
});

test("cache rollup: a known 5m/1h split computes a real netBenefitTokens", async () => {
  // Recorded outside the 1h window (but inside 24h, which this test queries)
  // so it can't land in the same 5-minute bucket as the row the later "1h
  // window" test asserts an exact token count against — that collision is
  // exactly the class of bug this file's test-ordering comments warn about.
  recordAt(hoursAgo(2), {
    taskId: "cache-split", model: "claude-opus-4-8",
    inputTokens: 500, outputTokens: 50, cacheReadTokens: 1000,
    cacheCreationTokens: 300, cacheCreate5mTokens: 200, cacheCreate1hTokens: 100,
  });
  const s = await observabilitySeries("24h");
  const anthropic = s.cache.find((c) => c.provider === "anthropic")!;
  assert.equal(anthropic.cacheCreate5mTokens, 200);
  assert.equal(anthropic.cacheCreate1hTokens, 100);
  // readSavings = cacheReadTokens * 0.9; writePremium = 5m*0.25 + 1h*1.0.
  // This aggregate now includes prior anthropic rows too (shared-DB, additive
  // sums), so compute the expectation from the same totals the row exposes
  // rather than hardcoding a number that would silently drift.
  const expected = Math.round((anthropic.cacheReadTokens * 0.9 - (anthropic.cacheCreate5mTokens! * 0.25 + anthropic.cacheCreate1hTokens! * 1.0)) * 10) / 10;
  assert.equal(anthropic.netBenefitTokens, expected);
});

test("7d/30d windows bucket by day with a continuous zero-filled axis", async () => {
  const week = await observabilitySeries("7d");
  assert.equal(week.unit, "day");
  assert.equal(week.points.length, 7);
  // Axis is continuous even on days with no runs.
  for (const p of week.points) assert.equal(typeof p.t, "string");

  const month = await observabilitySeries("30d");
  assert.equal(month.points.length, 30);
});

// Placed last: this test records a new row, and every test above asserts
// exact 24h-window counts/sums against the shared DB — inserting earlier
// would silently change their expected totals (this is exactly how the
// first draft of this test broke two unrelated tests above).
test("1h window buckets in 5-minute increments; the SQL bucketExpr and JS bucketLabel must agree", async () => {
  // A timestamp landing on a non-boundary minute (not itself a multiple of
  // 5) is the case that actually exercises the floor-to-5-minutes logic —
  // and it's computed entirely independently of series.ts's own bucketLabel()
  // so this test can't just be reproducing the same bug on both sides.
  const knownMinute = new Date(Date.now() - 6 * 60_000); // safely in the past, well inside the 1h window
  knownMinute.setSeconds(0, 0);
  while (knownMinute.getMinutes() % 5 === 0) knownMinute.setMinutes(knownMinute.getMinutes() - 1);

  recordAt(knownMinute.toISOString(), { taskId: "min-bucket", model: "claude-opus-4-8", inputTokens: 42, outputTokens: 7 });

  const s = await observabilitySeries("1h");
  assert.equal(s.unit, "minute");
  assert.equal(s.points.length, 12); // 60 minutes / 5-minute buckets

  const pad = (n: number) => String(n).padStart(2, "0");
  const flooredMinute = Math.floor(knownMinute.getMinutes() / 5) * 5;
  const expectedLabel = `${knownMinute.getFullYear()}-${pad(knownMinute.getMonth() + 1)}-${pad(knownMinute.getDate())}T${pad(knownMinute.getHours())}:${pad(flooredMinute)}`;

  const bucket = s.points.find((p) => p.t === expectedLabel);
  assert.ok(bucket, `expected a bucket labeled ${expectedLabel} among: ${s.points.map((p) => p.t).join(", ")}`);
  assert.ok(bucket!.byProvider["anthropic"], "the row landed in its bucket — proving the SQL and JS bucket labels agree");
  assert.equal(bucket!.byProvider["anthropic"].inputTokens, 42);
});

// Regression for the "1h view misbehaves" bug: the SQL cutoff used to be a
// raw `now - windowMs` (full-precision "now"), while the axis's earliest
// label was built from a *floored* "now". Since floor(now) <= now, that made
// the axis start later than the SQL cutoff — so a row landing in the sliver
// between them was counted in `totals.runs` (a plain SUM, no bucket join) but
// had no matching bucket and was silently dropped from `points`. This test
// plants a row right at that historical seam (just inside the 1h SQL cutoff,
// in the oldest 5-minute bucket) and asserts totals and the summed buckets
// agree — the class of drop this file's other 1h test doesn't exercise
// because it plants its row safely mid-window (6 minutes ago).
test("1h window: every row counted in totals lands in a bucket (no edge-of-window drop)", async () => {
  const edge = new Date(Date.now() - 59 * 60_000); // just inside the 60-minute SQL cutoff
  recordAt(edge.toISOString(), { taskId: "edge-bucket", model: "claude-opus-4-8", inputTokens: 11, outputTokens: 3 });

  const s = await observabilitySeries("1h");
  const summedRuns = s.points.reduce(
    (acc, p) => acc + Object.values(p.byProvider).reduce((a, c) => a + c.runs, 0),
    0,
  );
  assert.equal(summedRuns, s.totals.runs, "sum of per-bucket runs must equal the independently-computed total — a mismatch means a row was counted but dropped from the chart");
});
