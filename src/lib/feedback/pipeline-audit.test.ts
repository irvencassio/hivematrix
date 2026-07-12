import assert from "node:assert/strict";
import test from "node:test";

import { pipelineConcerns } from "./pipeline-audit";
import type { Scoreboard } from "./scoreboard";
import type { TierScorecardRow } from "@/lib/observability/contracts";

function scoreboard(over: Partial<Scoreboard> = {}): Scoreboard {
  return { goalsTracked: 0, criteriaProven: 2, criteriaTotal: 4, tasksDone: 10, tasksFailed: 1, windowDays: 7, firstPassRate: 0.8, ...over };
}
function tier(over: Partial<TierScorecardRow> = {}): TierScorecardRow {
  return { tier: "Haiku", tasks: 5, runs: 6, avgRunsPerTask: 1.2, firstAttempts: 5, firstPassRate: 0.9, costUsd: null, costPerTask: null, ...over };
}

test("healthy pipeline files no concerns", () => {
  const concerns = pipelineConcerns({
    scoreboard: scoreboard(),
    tierScorecard: [tier({ tier: "Haiku", firstPassRate: 0.85 }), tier({ tier: "Opus", firstPassRate: 0.9, costUsd: 0.1, costPerTask: 0.02 })],
    loopResolutionRate: 0.8,
    loopItems: 10,
  });
  assert.deepEqual(concerns, []);
});

test("flags a weak tier lagging the best-performing tier as an escalation enhancement", () => {
  const concerns = pipelineConcerns({
    scoreboard: scoreboard(),
    tierScorecard: [tier({ tier: "Haiku", firstPassRate: 0.4 }), tier({ tier: "Opus", firstPassRate: 0.9 })],
    loopResolutionRate: 0.8, loopItems: 10,
  });
  assert.ok(concerns.find((c) => /escalate haiku tasks to a stronger tier/i.test(c.title) && c.kind === "enhancement"));
});

test("flags a high task-failure rate as a bug", () => {
  const concerns = pipelineConcerns({
    scoreboard: scoreboard({ tasksDone: 4, tasksFailed: 6 }),
    tierScorecard: [], loopResolutionRate: 0.8, loopItems: 10,
  });
  assert.ok(concerns.find((c) => /failure rate/i.test(c.title) && c.kind === "bug"));
});

test("flags stalled directive criteria and a clogged feedback loop", () => {
  const concerns = pipelineConcerns({
    scoreboard: scoreboard({ criteriaProven: 0, criteriaTotal: 5, tasksDone: 0, tasksFailed: 0 }),
    tierScorecard: [], loopResolutionRate: 0.3, loopItems: 8,
  });
  assert.ok(concerns.find((c) => /criteria are not advancing/i.test(c.title)));
  assert.ok(concerns.find((c) => /backlog resolution is low/i.test(c.title)));
});

test("a single active tier never triggers an escalation concern (nothing to compare against)", () => {
  const concerns = pipelineConcerns({
    scoreboard: scoreboard(),
    tierScorecard: [tier({ tier: "Haiku", firstPassRate: 0.3 })],
    loopResolutionRate: 0.8, loopItems: 10,
  });
  // Only one tier has data — worst and best are the same row, so there's no
  // meaningful comparison, matching the old guard against a retired local
  // route leaking into the frontier side of the comparison.
  assert.equal(concerns.find((c) => /escalate/i.test(c.title)), undefined);
});

test("a strong tier with 95% first-pass doesn't widen the gap for an unrelated weak tier below the task floor", () => {
  const concerns = pipelineConcerns({
    scoreboard: scoreboard(),
    tierScorecard: [
      tier({ tier: "Haiku", tasks: 2, firstPassRate: 0.5 }), // below MIN_TIER_TASKS — excluded
      tier({ tier: "Sonnet", firstPassRate: 0.65 }),
      tier({ tier: "Opus", firstPassRate: 0.95 }),
    ],
    loopResolutionRate: 0.8, loopItems: 10,
  });
  // Sonnet (0.65) is the eligible worst tier; it's above TIER_FLOOR (0.6), so no concern.
  assert.equal(concerns.find((c) => /escalate/i.test(c.title)), undefined);
});

test("thin data → no concerns (needs a real sample)", () => {
  const concerns = pipelineConcerns({
    scoreboard: scoreboard({ criteriaProven: 0, criteriaTotal: 1, tasksDone: 1, tasksFailed: 1 }),
    tierScorecard: [tier({ tier: "Haiku", tasks: 1, firstPassRate: 0.1 })],
    loopResolutionRate: 0.1, loopItems: 2,
  });
  assert.deepEqual(concerns, []);
});
