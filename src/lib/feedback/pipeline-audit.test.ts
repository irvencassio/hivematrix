import assert from "node:assert/strict";
import test from "node:test";

import { pipelineConcerns } from "./pipeline-audit";
import type { Scoreboard } from "./scoreboard";
import type { RouteScorecardRow } from "@/lib/observability/contracts";

function scoreboard(over: Partial<Scoreboard> = {}): Scoreboard {
  return { goalsTracked: 0, criteriaProven: 2, criteriaTotal: 4, tasksDone: 10, tasksFailed: 1, windowDays: 7, firstPassRate: 0.8, ...over };
}
function route(over: Partial<RouteScorecardRow>): RouteScorecardRow {
  return { route: "local-qwen", tasks: 5, runs: 6, avgRunsPerTask: 1.2, firstAttempts: 5, firstPassRate: 0.9, costUsd: null, costPerTask: null, ...over };
}

test("healthy pipeline files no concerns", () => {
  const concerns = pipelineConcerns({
    scoreboard: scoreboard(),
    routeScorecard: [route({ route: "local-qwen", firstPassRate: 0.85 }), route({ route: "anthropic", firstPassRate: 0.9, costUsd: 0.1, costPerTask: 0.02 })],
    loopResolutionRate: 0.8,
    loopItems: 10,
  });
  assert.deepEqual(concerns, []);
});

test("flags local coding lagging the frontier as a re-route enhancement", () => {
  const concerns = pipelineConcerns({
    scoreboard: scoreboard(),
    routeScorecard: [route({ route: "local-qwen", firstPassRate: 0.4 }), route({ route: "anthropic", firstPassRate: 0.9 })],
    loopResolutionRate: 0.8, loopItems: 10,
  });
  assert.ok(concerns.find((c) => /route coding to the frontier/i.test(c.title) && c.kind === "enhancement"));
});

test("flags a high task-failure rate as a bug", () => {
  const concerns = pipelineConcerns({
    scoreboard: scoreboard({ tasksDone: 4, tasksFailed: 6 }),
    routeScorecard: [], loopResolutionRate: 0.8, loopItems: 10,
  });
  assert.ok(concerns.find((c) => /failure rate/i.test(c.title) && c.kind === "bug"));
});

test("flags stalled directive criteria and a clogged feedback loop", () => {
  const concerns = pipelineConcerns({
    scoreboard: scoreboard({ criteriaProven: 0, criteriaTotal: 5, tasksDone: 0, tasksFailed: 0 }),
    routeScorecard: [], loopResolutionRate: 0.3, loopItems: 8,
  });
  assert.ok(concerns.find((c) => /criteria are not advancing/i.test(c.title)));
  assert.ok(concerns.find((c) => /backlog resolution is low/i.test(c.title)));
});

test("thin data → no concerns (needs a real sample)", () => {
  const concerns = pipelineConcerns({
    scoreboard: scoreboard({ criteriaProven: 0, criteriaTotal: 1, tasksDone: 1, tasksFailed: 1 }),
    routeScorecard: [route({ route: "local-qwen", tasks: 1, firstPassRate: 0.1 })],
    loopResolutionRate: 0.1, loopItems: 2,
  });
  assert.deepEqual(concerns, []);
});
