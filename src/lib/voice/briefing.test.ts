import test from "node:test";
import assert from "node:assert/strict";
import { buildVoiceBriefing, pipelineConcern, type BriefingPipelineRoute } from "./briefing";

test("briefing speaks pending approvals, failed tasks, active directives, and usage", () => {
  const briefing = buildVoiceBriefing({
    approvals: [{ title: "Review release plan", kind: "checkpoint" }],
    failedTasks: [{ title: "Sign desktop build" }],
    directives: [
      { goal: "Release watcher", status: "active" },
      { goal: "Inbox cleanup", status: "sleeping" },
    ],
    usage: {
      totalCost: 12.345,
      todayCost: 1.2,
      taskCount: 4,
      todayTaskCount: 1,
      subscriptionPercentRemaining: 42,
    },
  });

  assert.match(briefing, /1 approval/);
  assert.match(briefing, /Review release plan/);
  assert.match(briefing, /1 failed task/);
  assert.match(briefing, /Sign desktop build/);
  assert.match(briefing, /1 active directive/);
  assert.match(briefing, /Release watcher/);
  assert.match(briefing, /\$12\.35/);
  assert.match(briefing, /42%/);
});

test("briefing speaks a compact Workflow Inbox line (reviews, ready actions, blocked/failed)", () => {
  const briefing = buildVoiceBriefing({
    workflowInbox: { needsReview: 2, ready: 1, blocked: 1, attention: 0 },
  });
  assert.match(briefing, /Workflow inbox/i);
  assert.match(briefing, /2 .*review/i);
  assert.match(briefing, /1 .*ready/i);
  assert.match(briefing, /1 .*blocked/i);
  // Compact: no artifact previews / script text leaking through.
  assert.doesNotMatch(briefing, /password|cookie|secret/i);
});

test("briefing omits the Workflow Inbox line when nothing is pending", () => {
  const empty = buildVoiceBriefing({ workflowInbox: { needsReview: 0, ready: 0, blocked: 0, attention: 0 } });
  assert.doesNotMatch(empty, /Workflow inbox/i);
  const none = buildVoiceBriefing({});
  assert.doesNotMatch(none, /Workflow inbox/i);
});

test("briefing reports Browser Lane sites needing attention (counts + top sites, no secrets)", () => {
  const briefing = buildVoiceBriefing({
    browserReadiness: {
      needsAttention: 2,
      byColor: { green: 1, yellow: 0, orange: 1, red: 0, gray: 1 },
      topSites: [
        { name: "HeyGen", color: "orange", status: "needs_reauth", siteId: "heygen", traceRunId: "trace-9" },
        { name: "Vercel", color: "gray", status: "unknown", siteId: "vercel", traceRunId: null },
      ],
    },
  });
  assert.match(briefing, /Browser Lane/);
  assert.match(briefing, /2 sites? need attention|needs attention/i);
  assert.match(briefing, /HeyGen/);
  assert.match(briefing, /needs_reauth|reauth/i);
  assert.doesNotMatch(briefing, /password|cookie|secret|credentialRef/i);
});

test("briefing gives an all-clear when no Browser Lane site needs attention", () => {
  const briefing = buildVoiceBriefing({
    browserReadiness: { needsAttention: 0, byColor: { green: 3, yellow: 0, orange: 0, red: 0, gray: 0 }, topSites: [], staleCount: 0, lastSweepAt: "2026-06-25T07:00:00.000Z" },
  });
  assert.match(briefing, /Browser Lane/);
  assert.match(briefing, /ready|all clear|no sites/i);
});

test("briefing speaks a compact pipeline-health line with per-route first-pass rate", () => {
  const briefing = buildVoiceBriefing({
    pipelineHealth: {
      totalRuns: 12,
      routes: [
        { route: "local", tasks: 6, firstPassPct: 50, avgRunsPerTask: 1.8 },
        { route: "Claude", tasks: 4, firstPassPct: 90, avgRunsPerTask: 1.0 },
      ],
      concern: null,
    },
  });
  assert.match(briefing, /Pipeline/);
  assert.match(briefing, /local 50% first-pass/);
  assert.match(briefing, /Claude 90% first-pass/);
  assert.match(briefing, /runs\/task/);
});

test("briefing omits the pipeline line when there is no telemetry", () => {
  assert.doesNotMatch(buildVoiceBriefing({ pipelineHealth: { totalRuns: 0, routes: [], concern: null } }), /Pipeline/);
  assert.doesNotMatch(buildVoiceBriefing({}), /Pipeline/);
});

test("briefing surfaces the concern nudge when local coding lags the frontier", () => {
  const routes: BriefingPipelineRoute[] = [
    { route: "local", tasks: 8, firstPassPct: 45, avgRunsPerTask: 2.1 },
    { route: "Claude", tasks: 5, firstPassPct: 88, avgRunsPerTask: 1.1 },
  ];
  const concern = pipelineConcern(routes);
  assert.ok(concern, "a material gap should produce a nudge");
  assert.match(concern!, /routing coding to the frontier/i);

  const briefing = buildVoiceBriefing({ pipelineHealth: { totalRuns: 20, routes, concern } });
  assert.match(briefing, /consider routing coding to the frontier/i);
});

test("pipelineConcern stays quiet on thin samples, small gaps, or healthy local", () => {
  // Thin sample: local has < 3 tasks.
  assert.equal(pipelineConcern([
    { route: "local", tasks: 2, firstPassPct: 10, avgRunsPerTask: 3 },
    { route: "Claude", tasks: 5, firstPassPct: 90, avgRunsPerTask: 1 },
  ]), null);
  // Small gap: local below floor but frontier not much better.
  assert.equal(pipelineConcern([
    { route: "local", tasks: 5, firstPassPct: 55, avgRunsPerTask: 1.5 },
    { route: "Claude", tasks: 5, firstPassPct: 68, avgRunsPerTask: 1.2 },
  ]), null);
  // Healthy local: above the floor.
  assert.equal(pipelineConcern([
    { route: "local", tasks: 9, firstPassPct: 80, avgRunsPerTask: 1.1 },
    { route: "Claude", tasks: 5, firstPassPct: 95, avgRunsPerTask: 1 },
  ]), null);
});

test("briefing mentions when readiness is stale and when it was last refreshed", () => {
  const stale = buildVoiceBriefing({
    browserReadiness: { needsAttention: 0, byColor: { green: 1, yellow: 0, orange: 0, red: 0, gray: 2 }, topSites: [], staleCount: 2, lastSweepAt: null },
  });
  assert.match(stale, /Browser Lane/);
  assert.match(stale, /stale/i);
  assert.doesNotMatch(stale, /password|cookie|secret/i);

  const refreshed = buildVoiceBriefing({
    browserReadiness: { needsAttention: 1, byColor: { green: 1, yellow: 0, orange: 1, red: 0, gray: 0 }, staleCount: 0, lastSweepAt: "2026-06-25T07:00:00.000Z",
      topSites: [{ name: "HeyGen", color: "orange", status: "needs_reauth", siteId: "heygen", traceRunId: "trace-9" }] },
  });
  assert.match(refreshed, /refreshed|checked|last/i);
  assert.match(refreshed, /HeyGen/);
});
