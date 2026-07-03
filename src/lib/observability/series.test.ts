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

test("series buckets across all three providers within the window", () => {
  recordAt(hoursAgo(0), { taskId: "a", model: "claude-opus-4-8", inputTokens: 1000, outputTokens: 200, cacheReadTokens: 800, cacheCreationTokens: 150, costUsd: 0.02 });
  recordAt(hoursAgo(1), { taskId: "b", model: "codex:gpt-5.5-codex", inputTokens: 500, outputTokens: 100, cacheReadTokens: 200 });
  recordAt(hoursAgo(2), { taskId: "c", model: "qwen3-coder-30b", inputTokens: 300, outputTokens: 80 });
  recordAt(hoursAgo(3), { taskId: "d", model: "deepseek-v4-flash", inputTokens: 400, outputTokens: 120 });
  recordAt(hoursAgo(40), { taskId: "old", model: "claude-opus-4-8", inputTokens: 999, outputTokens: 99, costUsd: 0.5 });

  const s = observabilitySeries("24h");
  assert.equal(s.unit, "hour");
  assert.equal(s.points.length, 24);
  // All three providers present; the 40h-old row is excluded from totals.
  assert.deepEqual(s.providers.slice().sort(), ["anthropic", "local-dwarfstar", "local-qwen", "openai-codex"]);
  assert.equal(s.totals.runs, 4);
  assert.equal(s.totals.tokens.input, 2200);
  // Only Claude reports cost; the old high-cost row is outside the window.
  assert.equal(s.totals.costUsd, 0.02);
});

test("cache rollup: supported providers get a hit-rate, local does not", () => {
  const s = observabilitySeries("24h");
  const byProv = Object.fromEntries(s.cache.map((c) => [c.provider, c]));

  // Claude: 800 cache reads out of 1000 input → 80% hit, 150 written.
  assert.equal(byProv["anthropic"].supported, true);
  assert.equal(byProv["anthropic"].hitRatePct, 80);
  assert.equal(byProv["anthropic"].cacheCreationTokens, 150);

  // Codex: cache reads tracked, hit-rate computed, no creation split.
  assert.equal(byProv["openai-codex"].supported, true);
  assert.equal(byProv["openai-codex"].hitRatePct, 40);

  // Local engines: caching not supported → null hit-rate.
  assert.equal(byProv["local-qwen"].supported, false);
  assert.equal(byProv["local-qwen"].hitRatePct, null);
  assert.equal(byProv["local-dwarfstar"].supported, false);
  assert.equal(byProv["local-dwarfstar"].hitRatePct, null);
});

test("7d/30d windows bucket by day with a continuous zero-filled axis", () => {
  const week = observabilitySeries("7d");
  assert.equal(week.unit, "day");
  assert.equal(week.points.length, 7);
  // Axis is continuous even on days with no runs.
  for (const p of week.points) assert.equal(typeof p.t, "string");

  const month = observabilitySeries("30d");
  assert.equal(month.points.length, 30);
});
