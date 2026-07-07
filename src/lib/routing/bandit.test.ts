import assert from "node:assert/strict";
import test from "node:test";

import { armScore, aggregateArms, recommendRoute, DEFAULT_MIN_PULLS } from "./bandit";
import { normalizeRun, type TaskTelemetry } from "@/lib/observability/contracts";

// Build N telemetry rows for one (class, model) arm: `passes` of them succeed on
// the first attempt, the rest fail; each carries `cost` (null for local).
function arm(taskClass: string, model: string, total: number, passes: number, cost: number | null): TaskTelemetry[] {
  const rows: TaskTelemetry[] = [];
  for (let i = 0; i < total; i++) {
    rows.push(normalizeRun({
      taskId: `${taskClass}-${model}-${i}`,
      runIndex: 0,
      model,
      role: taskClass,
      status: i < passes ? "done" : "failed",
      costUsd: cost,
      inputTokens: 10, outputTokens: 10,
    }));
  }
  return rows;
}

test("armScore rewards first-pass success and penalizes cost", () => {
  assert.ok(armScore(0.9, 0) > armScore(0.9, 0.1), "cost lowers the score");
  // A free arm can outscore a pricier arm with a higher first-pass rate.
  assert.ok(armScore(0.75, 0) > armScore(0.9, 0.1, 2), "free-but-good beats costly-but-better under the default penalty");
});

test("aggregateArms partitions by class and route with per-arm first-pass + avg cost", () => {
  const rows = [
    ...arm("coding", "qwen3.6-27b", 6, 3, null),        // local: 50% first-pass, free
    ...arm("coding", "claude-opus-4-8", 6, 6, 0.05),    // frontier: 100% first-pass, $0.05
  ];
  const classes = aggregateArms(rows);
  const coding = classes.find((c) => c.taskClass === "coding")!;
  const local = coding.arms.find((a) => a.route === "local-qwen")!;
  const frontier = coding.arms.find((a) => a.route === "anthropic")!;
  assert.equal(local.pulls, 6);
  assert.equal(local.firstPassRate, 0.5);
  assert.equal(local.avgCostUsd, 0);
  assert.equal(frontier.firstPassRate, 1);
  assert.ok(Math.abs(frontier.avgCostUsd - 0.05) < 1e-9);
  // Arms are score-sorted (best first). Here frontier's 100% beats local's 50%.
  assert.equal(coding.arms[0].route, "anthropic");
});

test("cold start: a class without two sufficiently-sampled routes defers to default", () => {
  // Only one arm clears the floor → cannot compare → defer (route null).
  const rows = [
    ...arm("coding", "qwen3.6-27b", DEFAULT_MIN_PULLS + 1, 4, null),
    ...arm("coding", "claude-opus-4-8", 2, 2, 0.05), // below the floor
  ];
  const [coding] = aggregateArms(rows);
  const rec = recommendRoute(coding, { rng: () => 0.5 });
  assert.equal(rec.route, null);
  assert.match(rec.reason, /insufficient data|defer/i);
});

test("exploit: with enough data and no exploration, recommends the best-utility route", () => {
  const rows = [
    ...arm("extract", "qwen3.6-27b", 8, 7, null),     // local: 87.5% free
    ...arm("extract", "claude-opus-4-8", 8, 8, 0.08), // frontier: 100% but $0.08
  ];
  const [extract] = aggregateArms(rows);
  // epsilon 0 → pure exploitation. Free-and-good local should win under the penalty.
  const rec = recommendRoute(extract, { epsilon: 0 });
  assert.equal(rec.explore, false);
  assert.equal(rec.route, "local-qwen");
  assert.match(rec.reason, /best utility/i);
});

test("explore: with epsilon high, picks a non-best trusted arm and flags it", () => {
  const rows = [
    ...arm("coding", "qwen3.6-27b", 8, 4, null),
    ...arm("coding", "claude-opus-4-8", 8, 8, 0.05),
  ];
  const [coding] = aggregateArms(rows);
  // rng always < epsilon → always explore; second rng()=0 picks the first "other".
  const rec = recommendRoute(coding, { epsilon: 1, rng: () => 0 });
  assert.equal(rec.explore, true);
  assert.notEqual(rec.route, coding.arms[0].route, "exploration picks a non-best arm");
});
