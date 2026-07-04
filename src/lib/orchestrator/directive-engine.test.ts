import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Point the DB at a temp file BEFORE importing anything that opens it.
const TMP = mkdtempSync(join(tmpdir(), "hm-directive-test-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests, Task } = await import("@/lib/db");
const {
  createDirective,
  addCriterion,
  getDirective,
  getCriteria,
  getJournal,
  getActiveRuns,
  getRun,
  getRecentTerminalRuns,
  createRun,
  setRunPhase,
  deleteDirective,
} = await import("./directive-store");
const {
  directiveTick,
  _setDirectivePlannerForTests,
  _setDirectiveReviewerForTests,
  _setDirectiveRetrospectiveForTests,
  _setDirectiveCheckpointResolverForTests,
} = await import("./directive-engine");

// Fresh DB for this file.
_resetDbForTests();
getDb();

test.after(() => {
  _setDirectivePlannerForTests(null);
  _setDirectiveReviewerForTests(null);
  _setDirectiveRetrospectiveForTests(null);
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

test.beforeEach(() => {
  _setDirectivePlannerForTests(null);
  _setDirectiveReviewerForTests(null);
  _setDirectiveRetrospectiveForTests(null);
  _setDirectiveCheckpointResolverForTests(null);
});

test.afterEach(() => {
  _setDirectivePlannerForTests(null);
  _setDirectiveReviewerForTests(null);
  _setDirectiveRetrospectiveForTests(null);
  _setDirectiveCheckpointResolverForTests(null);
});

function mkDirective(extra: Record<string, unknown> = {}) {
  return createDirective({
    goal: "Keep the docs index current",
    profile: "default",
    project: "hivematrix",
    projectPath: "/tmp",
    triggerPolicy: { type: "schedule", interval: "PT1H" },
    ...extra,
  });
}

function useLegacyDeterministicPhases() {
  _setDirectivePlannerForTests(async () => null);
  _setDirectiveReviewerForTests(async () => null);
  _setDirectiveRetrospectiveForTests(async () => null);
}

// Drive a run from plan to done, simulating task completion between ticks.
async function completeRunTasks(directiveId: string, runId: string, status = "review") {
  const tasks = await Task.find({ directiveId });
  for (const t of tasks) {
    const out = (t.output ?? {}) as Record<string, unknown>;
    if (out.runId === runId && !out.directivePhase) {
      await Task.findByIdAndUpdate(t._id.toString(), { status });
    }
  }
}

async function getRunTasks(directiveId: string, runId: string) {
  const tasks = await Task.find({ directiveId });
  return tasks.filter((t) => ((t.output ?? {}) as Record<string, unknown>).runId === runId);
}

async function completeTaskWithSummary(taskId: string, status: string, summary: string) {
  const task = await Task.findById(taskId);
  assert.ok(task, `task ${taskId} should exist`);
  await Task.findByIdAndUpdate(taskId, {
    status,
    output: {
      ...(task.output ?? {}),
      summary,
    },
  });
}

test("directiveTick opens a run for a due directive and journals run_started", async () => {
  const d = mkDirective();
  assert.equal(getActiveRuns().length, 0);

  await directiveTick(new Date("2026-06-11T12:00:00Z"));

  const runs = getActiveRuns();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].directiveId, d._id);
  const steps = getJournal(runs[0]._id).map((j) => j.step);
  assert.ok(steps.includes("run_started"));
});

test("plan phase creates one task per unmet criterion and moves to execute", async () => {
  useLegacyDeterministicPhases();
  const d = mkDirective();
  addCriterion(d._id, "criterion A");
  addCriterion(d._id, "criterion B");

  await directiveTick(new Date("2026-06-11T12:00:00Z")); // open run (phase plan)
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T12:00:01Z")); // plan → execute

  const after = getRun(run._id)!;
  assert.equal(after.phase, "execute");

  const tasks = (await Task.find({ directiveId: d._id })).filter(
    (t) => (t.output as Record<string, unknown>)?.runId === run._id
  );
  assert.equal(tasks.length, 2, "one task per unmet criterion");
  assert.ok(getJournal(run._id).some((j) => j.step === "planned"));
});

test("execute phase waits for tasks, then verify proves criteria, reflect re-arms", async () => {
  useLegacyDeterministicPhases();
  const d = mkDirective();
  addCriterion(d._id, "the one criterion");

  await directiveTick(new Date("2026-06-11T12:00:00Z")); // open
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T12:00:01Z")); // plan → execute

  // Tasks still backlog → execute should NOT advance.
  await directiveTick(new Date("2026-06-11T12:00:02Z"));
  assert.equal(getRun(run._id)!.phase, "execute", "waits while tasks unfinished");

  // Complete the run's tasks, then tick through verify → reflect → done.
  await completeRunTasks(d._id, run._id, "review");
  await directiveTick(new Date("2026-06-11T12:00:03Z")); // execute → verify
  assert.equal(getRun(run._id)!.phase, "verify");
  await directiveTick(new Date("2026-06-11T12:00:04Z")); // verify → reflect
  assert.equal(getRun(run._id)!.phase, "reflect");
  await directiveTick(new Date("2026-06-11T12:00:05Z")); // reflect → done

  const finalRun = getRun(run._id)!;
  assert.equal(finalRun.phase, "done");

  // Criterion proven → directive marked done.
  assert.ok(getCriteria(d._id).every((c) => c.proven === 1));
  assert.equal(getDirective(d._id)!.status, "done");

  const steps = getJournal(run._id).map((j) => j.step);
  for (const expected of ["run_started", "planned", "executed", "verified", "reflected", "yielded"]) {
    assert.ok(steps.includes(expected), `journal should include ${expected}`);
  }
});

test("directive with no criteria runs a goal task but stays active (cannot self-complete)", async () => {
  useLegacyDeterministicPhases();
  const d = mkDirective({ triggerPolicy: { type: "schedule", interval: "PT2H" } });

  await directiveTick(new Date("2026-06-11T12:00:00Z"));
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T12:00:01Z")); // plan → execute (1 goal task)
  await completeRunTasks(d._id, run._id, "review");
  await directiveTick(new Date("2026-06-11T12:00:02Z")); // → verify
  await directiveTick(new Date("2026-06-11T12:00:03Z")); // → reflect
  await directiveTick(new Date("2026-06-11T12:00:04Z")); // → done + re-arm

  // No criteria ⇒ allCriteriaProven is false ⇒ directive re-armed, not done.
  const dir = getDirective(d._id)!;
  assert.equal(dir.status, "active");
  assert.ok(dir.nextRunAt && dir.nextRunAt > "2026-06-11T12:00:04Z", "nextRunAt re-armed into the future");
});

test("manual directive without a schedule goes to sleeping after its run", async () => {
  _setDirectivePlannerForTests(async () => null);
  _setDirectiveReviewerForTests(async () => `\`\`\`json
{
  "status": "fail",
  "findings": [],
  "gaps": ["manual directive remains unproven"],
  "correctiveTasks": [],
  "summary": "Do not prove the criterion."
}
\`\`\``);
  _setDirectiveRetrospectiveForTests(async () => null);
  const d = mkDirective({ triggerPolicy: { type: "manual" } });
  addCriterion(d._id, "c");

  await directiveTick(new Date("2026-06-11T12:00:00Z"));
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T12:00:01Z")); // plan→execute
  await completeRunTasks(d._id, run._id, "review");
  await directiveTick(new Date("2026-06-11T12:00:02Z")); // →verify
  await directiveTick(new Date("2026-06-11T12:00:03Z")); // →reflect
  await directiveTick(new Date("2026-06-11T12:00:04Z")); // →done

  // Criterion unproven + manual trigger (no nextRunAt) ⇒ sleeping.
  assert.equal(getDirective(d._id)!.status, "sleeping");
});

test("plan phase accepts autonomy planner output and records DAG metadata", async () => {
  const d = mkDirective();
  const c1 = addCriterion(d._id, "Research the current docs");
  const c2 = addCriterion(d._id, "Patch the implementation");

  _setDirectivePlannerForTests(async () => `\`\`\`json
{
  "tasks": [
    {
      "title": "Research docs",
      "description": "Read the docs and summarize constraints.",
      "agentType": "researcher",
      "dependsOn": [],
      "criterionRefs": ["${c1._id}"],
      "goalIndex": 0
    },
    {
      "title": "Patch implementation",
      "description": "Make the code change after research.",
      "agentType": "developer",
      "dependsOn": [0],
      "criterionRefs": ["${c2.description}"],
      "goalIndex": 1
    }
  ]
}
\`\`\``);

  await directiveTick(new Date("2026-06-11T13:00:00Z"));
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T13:00:01Z"));

  const tasks = (await Task.find({ directiveId: d._id })).filter(
    (t) => (t.output as Record<string, unknown>)?.runId === run._id
  );
  assert.equal(tasks.length, 2);
  const secondOutput = tasks.find((t) => String(t.title).includes("Patch implementation"))!.output as Record<string, unknown>;
  assert.equal(secondOutput.directiveDagIndex, 1);
  assert.deepEqual(secondOutput.dependsOnDagIndices, [0]);
  assert.deepEqual(secondOutput.criterionIds, [c2._id]);

  const planned = getJournal(run._id).find((j) => j.step === "task_dag_planned");
  assert.ok(planned, "journal should include accepted autonomy plan");
  _setDirectivePlannerForTests(null);
});

test("production planner phase task plans execution DAG after terminal JSON output", async () => {
  const d = mkDirective();
  const c = addCriterion(d._id, "Publish the autonomy plan");

  await directiveTick(new Date("2026-06-11T13:30:00Z"));
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T13:30:01Z"));

  assert.equal(getRun(run._id)!.phase, "plan", "planner phase task should keep run in plan while pending");
  const phaseTasks = (await getRunTasks(d._id, run._id)).filter(
    (t) => ((t.output ?? {}) as Record<string, unknown>).directivePhase === "planner"
  );
  assert.equal(phaseTasks.length, 1);
  assert.equal(phaseTasks[0].status, "backlog");

  await completeTaskWithSummary(phaseTasks[0]._id.toString(), "review", `\`\`\`json
{
  "tasks": [
    {
      "title": "Publish plan",
      "description": "Write and publish the autonomy plan.",
      "agentType": "developer",
      "criterionRefs": ["${c._id}"]
    }
  ]
}
\`\`\``);

  await directiveTick(new Date("2026-06-11T13:30:02Z"));
  assert.equal(getRun(run._id)!.phase, "execute");

  const runTasks = await getRunTasks(d._id, run._id);
  const executionTasks = runTasks.filter((t) => !((t.output ?? {}) as Record<string, unknown>).directivePhase);
  assert.equal(executionTasks.length, 1);
  assert.equal(((executionTasks[0].output ?? {}) as Record<string, unknown>).directiveDagIndex, 0);
  assert.ok(getJournal(run._id).some((j) => j.step === "planner_task_started"));
  assert.ok(getJournal(run._id).some((j) => j.step === "task_dag_planned"));
});

test("invalid autonomy planner output falls back to deterministic criterion tasks", async () => {
  const d = mkDirective();
  addCriterion(d._id, "Fallback criterion A");
  addCriterion(d._id, "Fallback criterion B");

  _setDirectivePlannerForTests(async () => "not json");

  await directiveTick(new Date("2026-06-11T14:00:00Z"));
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T14:00:01Z"));

  const tasks = (await Task.find({ directiveId: d._id })).filter(
    (t) => (t.output as Record<string, unknown>)?.runId === run._id
  );
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every((t) => ((t.output as Record<string, unknown>)?.directiveDagIndex ?? null) === null));
  assert.ok(getJournal(run._id).some((j) => j.step === "planning_fallback"));
  _setDirectivePlannerForTests(null);
});

test("review gate must pass before criteria are proven", async () => {
  _setDirectivePlannerForTests(async () => null);
  _setDirectiveRetrospectiveForTests(async () => null);
  const d = mkDirective();
  addCriterion(d._id, "Review-gated criterion");
  _setDirectiveReviewerForTests(async () => `\`\`\`json
{
  "status": "fail",
  "findings": [{ "task": "Task", "assessment": "fail", "notes": "Not enough evidence" }],
  "gaps": ["missing proof"],
  "correctiveTasks": [],
  "summary": "Do not prove yet."
}
\`\`\``);

  await directiveTick(new Date("2026-06-11T15:00:00Z"));
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T15:00:01Z"));
  await completeRunTasks(d._id, run._id, "review");
  await directiveTick(new Date("2026-06-11T15:00:02Z"));
  await directiveTick(new Date("2026-06-11T15:00:03Z"));

  assert.equal(getRun(run._id)!.phase, "reflect");
  assert.ok(getCriteria(d._id).every((c) => c.proven === 0));
  const review = getJournal(run._id).find((j) => j.step === "reviewed");
  assert.ok(review);
  assert.equal(JSON.parse(review.payload).status, "fail");
  _setDirectiveReviewerForTests(null);
});

test("review pass proves criteria", async () => {
  _setDirectivePlannerForTests(async () => null);
  _setDirectiveRetrospectiveForTests(async () => null);
  const d = mkDirective();
  addCriterion(d._id, "Review pass criterion");
  _setDirectiveReviewerForTests(async () => `\`\`\`json
{
  "status": "pass",
  "findings": [{ "task": "Task", "assessment": "pass", "notes": "Evidence sufficient" }],
  "gaps": [],
  "correctiveTasks": [],
  "summary": "Ready."
}
\`\`\``);

  await directiveTick(new Date("2026-06-11T16:00:00Z"));
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T16:00:01Z"));
  await completeRunTasks(d._id, run._id, "review");
  await directiveTick(new Date("2026-06-11T16:00:02Z"));
  await directiveTick(new Date("2026-06-11T16:00:03Z"));

  assert.ok(getCriteria(d._id).every((c) => c.proven === 1));
  _setDirectiveReviewerForTests(null);
});

test("review partial with corrective tasks creates tasks and returns to execute", async () => {
  _setDirectivePlannerForTests(async () => null);
  _setDirectiveRetrospectiveForTests(async () => null);
  const d = mkDirective();
  const c = addCriterion(d._id, "Correct the gap");
  _setDirectiveReviewerForTests(async () => `\`\`\`json
{
  "status": "partial",
  "findings": [],
  "gaps": ["needs one fix"],
  "correctiveTasks": [
    { "title": "Fix the gap", "description": "Add the missing proof.", "agentType": "developer", "criterionRefs": ["${c._id}"] }
  ],
  "summary": "Needs correction."
}
\`\`\``);

  await directiveTick(new Date("2026-06-11T17:00:00Z"));
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T17:00:01Z"));
  await completeRunTasks(d._id, run._id, "review");
  await directiveTick(new Date("2026-06-11T17:00:02Z"));
  await directiveTick(new Date("2026-06-11T17:00:03Z"));

  assert.equal(getRun(run._id)!.phase, "execute");
  const tasks = (await Task.find({ directiveId: d._id })).filter(
    (t) => (t.output as Record<string, unknown>)?.runId === run._id
  );
  assert.ok(tasks.some((t) => String(t.title).includes("Fix the gap")));
  const review = getJournal(run._id).find((j) => j.step === "reviewed");
  assert.ok(review);
  const payload = JSON.parse(review.payload);
  assert.equal(payload.status, "partial");
  assert.equal(payload.correctiveTaskIds.length, 1);
  _setDirectiveReviewerForTests(null);
});

test("production reviewer phase task gates proof until terminal pass JSON", async () => {
  const d = mkDirective();
  const c = addCriterion(d._id, "Reviewer proves this");

  await directiveTick(new Date("2026-06-11T17:30:00Z"));
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T17:30:01Z"));
  const plannerTask = (await getRunTasks(d._id, run._id)).find(
    (t) => ((t.output ?? {}) as Record<string, unknown>).directivePhase === "planner"
  )!;
  await completeTaskWithSummary(plannerTask._id.toString(), "review", `\`\`\`json
{ "tasks": [{ "title": "Do proof work", "description": "Produce evidence.", "criterionRefs": ["${c._id}"] }] }
\`\`\``);
  await directiveTick(new Date("2026-06-11T17:30:02Z"));
  await completeRunTasks(d._id, run._id, "review");
  await directiveTick(new Date("2026-06-11T17:30:03Z")); // execute -> verify
  await directiveTick(new Date("2026-06-11T17:30:04Z")); // start reviewer task

  assert.equal(getRun(run._id)!.phase, "verify");
  const reviewerTask = (await getRunTasks(d._id, run._id)).find(
    (t) => ((t.output ?? {}) as Record<string, unknown>).directivePhase === "reviewer"
  );
  assert.ok(reviewerTask);
  assert.ok(getCriteria(d._id).every((criterion) => criterion.proven === 0));

  await completeTaskWithSummary(reviewerTask._id.toString(), "review", `\`\`\`json
{
  "status": "pass",
  "findings": [{ "task": "Do proof work", "assessment": "pass", "notes": "Evidence satisfies the criterion." }],
  "gaps": [],
  "correctiveTasks": [],
  "summary": "Pass."
}
\`\`\``);
  await directiveTick(new Date("2026-06-11T17:30:05Z"));

  assert.equal(getRun(run._id)!.phase, "reflect");
  assert.ok(getCriteria(d._id).every((criterion) => criterion.proven === 1));
  assert.ok(getJournal(run._id).some((j) => j.step === "reviewer_task_started"));
  assert.ok(getJournal(run._id).some((j) => j.step === "reviewed"));
});

test("production reviewer phase task can create corrective tasks and return to execute", async () => {
  const d = mkDirective();
  const c = addCriterion(d._id, "Reviewer requests correction");

  await directiveTick(new Date("2026-06-11T17:45:00Z"));
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T17:45:01Z"));
  const plannerTask = (await getRunTasks(d._id, run._id)).find(
    (t) => ((t.output ?? {}) as Record<string, unknown>).directivePhase === "planner"
  )!;
  await completeTaskWithSummary(plannerTask._id.toString(), "review", `\`\`\`json
{ "tasks": [{ "title": "Initial attempt", "description": "Try to satisfy the criterion.", "criterionRefs": ["${c._id}"] }] }
\`\`\``);
  await directiveTick(new Date("2026-06-11T17:45:02Z"));
  await completeRunTasks(d._id, run._id, "review");
  await directiveTick(new Date("2026-06-11T17:45:03Z"));
  await directiveTick(new Date("2026-06-11T17:45:04Z"));
  const reviewerTask = (await getRunTasks(d._id, run._id)).find(
    (t) => ((t.output ?? {}) as Record<string, unknown>).directivePhase === "reviewer"
  )!;

  await completeTaskWithSummary(reviewerTask._id.toString(), "review", `\`\`\`json
{
  "status": "partial",
  "findings": [],
  "gaps": ["needs a stronger artifact"],
  "correctiveTasks": [
    { "title": "Strengthen proof", "description": "Add the missing artifact.", "criterionRefs": ["${c._id}"] }
  ],
  "summary": "Needs one correction."
}
\`\`\``);
  await directiveTick(new Date("2026-06-11T17:45:05Z"));

  assert.equal(getRun(run._id)!.phase, "execute");
  const executionTasks = (await getRunTasks(d._id, run._id)).filter(
    (t) => !((t.output ?? {}) as Record<string, unknown>).directivePhase
  );
  assert.ok(executionTasks.some((t) => String(t.title).includes("Strengthen proof")));
  assert.ok(getCriteria(d._id).every((criterion) => criterion.proven === 0));
});

test("production execution failure creates a replanner task before verify", async () => {
  const d = mkDirective();
  const c = addCriterion(d._id, "Recover from failed execution");

  await directiveTick(new Date("2026-06-11T18:00:00Z"));
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T18:00:01Z"));
  const plannerTask = (await getRunTasks(d._id, run._id)).find(
    (t) => ((t.output ?? {}) as Record<string, unknown>).directivePhase === "planner"
  )!;
  await completeTaskWithSummary(plannerTask._id.toString(), "review", `\`\`\`json
{ "tasks": [{ "title": "First attempt", "description": "Try the work.", "criterionRefs": ["${c._id}"] }] }
\`\`\``);
  await directiveTick(new Date("2026-06-11T18:00:02Z"));

  const firstExecutionTask = (await getRunTasks(d._id, run._id)).find(
    (t) => !((t.output ?? {}) as Record<string, unknown>).directivePhase
  )!;
  await Task.findByIdAndUpdate(firstExecutionTask._id.toString(), { status: "failed" });
  await directiveTick(new Date("2026-06-11T18:00:03Z"));

  assert.equal(getRun(run._id)!.phase, "execute");
  const replannerTask = (await getRunTasks(d._id, run._id)).find(
    (t) => ((t.output ?? {}) as Record<string, unknown>).directivePhase === "replanner"
  );
  assert.ok(replannerTask);
  assert.match(String(replannerTask.description), new RegExp(firstExecutionTask._id.toString()));
  assert.ok(getJournal(run._id).some((j) => j.step === "replan_task_started"));

  await completeTaskWithSummary(replannerTask._id.toString(), "review", `\`\`\`json
{ "tasks": [{ "title": "Second attempt", "description": "Recover and prove the criterion.", "criterionRefs": ["${c._id}"] }] }
\`\`\``);
  await directiveTick(new Date("2026-06-11T18:00:04Z"));

  assert.equal(getRun(run._id)!.phase, "execute");
  const runTasks = await getRunTasks(d._id, run._id);
  const executionTasks = runTasks.filter((t) => !((t.output ?? {}) as Record<string, unknown>).directivePhase);
  assert.equal(executionTasks.length, 2);
  assert.ok(executionTasks.some((t) => String(t.title).includes("Second attempt")));
  const consumedReplanner = (await Task.findById(replannerTask._id.toString()))!;
  assert.ok(((consumedReplanner.output ?? {}) as Record<string, unknown>).directivePhaseConsumedAt);
  assert.ok(getJournal(run._id).some((j) => j.step === "replanned"));
});

test("invalid production replanner output falls back to verify", async () => {
  const d = mkDirective();
  const c = addCriterion(d._id, "Fallback after invalid replan");

  await directiveTick(new Date("2026-06-11T18:10:00Z"));
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T18:10:01Z"));
  const plannerTask = (await getRunTasks(d._id, run._id)).find(
    (t) => ((t.output ?? {}) as Record<string, unknown>).directivePhase === "planner"
  )!;
  await completeTaskWithSummary(plannerTask._id.toString(), "review", `\`\`\`json
{ "tasks": [{ "title": "Failing attempt", "description": "Try the work.", "criterionRefs": ["${c._id}"] }] }
\`\`\``);
  await directiveTick(new Date("2026-06-11T18:10:02Z"));

  const executionTask = (await getRunTasks(d._id, run._id)).find(
    (t) => !((t.output ?? {}) as Record<string, unknown>).directivePhase
  )!;
  await Task.findByIdAndUpdate(executionTask._id.toString(), { status: "failed" });
  await directiveTick(new Date("2026-06-11T18:10:03Z"));
  const replannerTask = (await getRunTasks(d._id, run._id)).find(
    (t) => ((t.output ?? {}) as Record<string, unknown>).directivePhase === "replanner"
  )!;

  await completeTaskWithSummary(replannerTask._id.toString(), "review", "not json");
  await directiveTick(new Date("2026-06-11T18:10:04Z"));

  assert.equal(getRun(run._id)!.phase, "verify");
  assert.ok(getJournal(run._id).some((j) => j.step === "replan_fallback"));
});

test("reflect phase records retrospective learning paths", async () => {
  _setDirectivePlannerForTests(async () => null);
  _setDirectiveReviewerForTests(async () => null);
  const brainRoot = mkdtempSync(join(TMP, "brain-"));
  const d = mkDirective();
  addCriterion(d._id, "Retrospective criterion");
  _setDirectiveRetrospectiveForTests(async () => `\`\`\`json
{
  "overallAssessment": "Done.",
  "playbookDeltas": [
    { "scope": "role:coo", "rule": "Keep directive plans reviewable" }
  ],
  "accessLedger": [
    { "system": "GitHub", "status": "configured", "notes": "Repo access worked" }
  ]
}
\`\`\``);

  await directiveTick(new Date("2026-06-11T18:00:00Z"));
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T18:00:01Z"));
  await completeRunTasks(d._id, run._id, "review");
  await directiveTick(new Date("2026-06-11T18:00:02Z"));
  await directiveTick(new Date("2026-06-11T18:00:03Z"));
  assert.equal(getRun(run._id)!.phase, "reflect");
  await directiveTick(new Date("2026-06-11T18:00:04Z"), { brainRootDir: brainRoot });

  const journalEntry = getJournal(run._id).find((j) => j.step === "retrospective_recorded");
  assert.ok(journalEntry);
  const payload = JSON.parse(journalEntry.payload);
  assert.equal(payload.roleFiles.length, 1);
  assert.ok(payload.accessLedgerFile);
  assert.match(readFileSync(join(brainRoot, "hive", "playbooks", "roles", "coo.md"), "utf-8"), /Keep directive plans reviewable/);
  assert.match(readFileSync(join(brainRoot, "hive", "playbooks", "projects", "hivematrix-access.md"), "utf-8"), /GitHub/);
  _setDirectiveRetrospectiveForTests(null);
});

test("production retrospective phase task records learning before yielding", async () => {
  _setDirectivePlannerForTests(async () => null);
  _setDirectiveReviewerForTests(async () => null);
  const brainRoot = mkdtempSync(join(TMP, "brain-production-"));
  const d = mkDirective();
  addCriterion(d._id, "Retrospective production criterion");

  await directiveTick(new Date("2026-06-11T18:30:00Z"));
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T18:30:01Z"));
  await completeRunTasks(d._id, run._id, "review");
  await directiveTick(new Date("2026-06-11T18:30:02Z"));
  await directiveTick(new Date("2026-06-11T18:30:03Z"));
  assert.equal(getRun(run._id)!.phase, "reflect");

  await directiveTick(new Date("2026-06-11T18:30:04Z"), { brainRootDir: brainRoot });
  assert.equal(getRun(run._id)!.phase, "reflect", "retrospective task should keep run in reflect while pending");
  const retrospectiveTask = (await getRunTasks(d._id, run._id)).find(
    (t) => ((t.output ?? {}) as Record<string, unknown>).directivePhase === "retrospective"
  );
  assert.ok(retrospectiveTask);

  await completeTaskWithSummary(retrospectiveTask._id.toString(), "review", `\`\`\`json
{
  "overallAssessment": "The run completed cleanly.",
  "playbookDeltas": [
    { "scope": "role:coo", "rule": "Capture production retrospective learnings before yielding" }
  ],
  "accessLedger": [
    { "system": "HiveMatrix", "status": "configured", "notes": "Directive phase tasks completed" }
  ]
}
\`\`\``);
  await directiveTick(new Date("2026-06-11T18:30:05Z"), { brainRootDir: brainRoot });

  assert.equal(getRun(run._id)!.phase, "done");
  assert.ok(getJournal(run._id).some((j) => j.step === "retrospective_task_started"));
  assert.ok(getJournal(run._id).some((j) => j.step === "retrospective_recorded"));
  assert.match(
    readFileSync(join(brainRoot, "hive", "playbooks", "roles", "coo.md"), "utf-8"),
    /Capture production retrospective learnings/
  );
});

type Decision = "approve" | "reject" | "pending";

function execTasksFor(directiveId: string, runId: string) {
  return getRunTasks(directiveId, runId).then((tasks) =>
    tasks.filter((t) => !((t.output ?? {}) as Record<string, unknown>).directivePhase)
  );
}

test("plan checkpoint holds the run before execution, then approves", async () => {
  useLegacyDeterministicPhases();
  const d = mkDirective({ approvalPolicy: { checkpoint: "plan" } });
  addCriterion(d._id, "criterion A");

  let decision: Decision = "pending";
  _setDirectiveCheckpointResolverForTests(async () => decision);

  await directiveTick(new Date("2026-06-11T12:00:00Z")); // open run (plan)
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T12:00:01Z")); // plan tick — held pending

  assert.equal(getRun(run._id)!.phase, "plan", "run holds in plan while checkpoint pending");
  assert.equal((await execTasksFor(d._id, run._id)).length, 0, "no execution tasks before approval");
  assert.ok(getJournal(run._id).some((j) => j.step === "checkpoint_pending" && j.payload.includes('"gate":"plan"')));

  decision = "approve";
  await directiveTick(new Date("2026-06-11T12:00:02Z")); // plan tick — approved
  assert.equal(getRun(run._id)!.phase, "execute");
  assert.equal((await execTasksFor(d._id, run._id)).length, 1);
  assert.ok(getJournal(run._id).some((j) => j.step === "checkpoint_approved" && j.payload.includes('"gate":"plan"')));
});

test("plan checkpoint rejection fails the run before any execution task", async () => {
  useLegacyDeterministicPhases();
  const d = mkDirective({ approvalPolicy: { checkpoint: "plan" } });
  addCriterion(d._id, "criterion A");
  _setDirectiveCheckpointResolverForTests(async () => "reject");

  await directiveTick(new Date("2026-06-11T12:10:00Z")); // open run (plan)
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T12:10:01Z")); // plan tick — rejected

  assert.equal(getRun(run._id)!.phase, "failed");
  assert.equal(getRun(run._id)!.failReason, "checkpoint_rejected");
  assert.equal((await execTasksFor(d._id, run._id)).length, 0, "no execution tasks spawned on rejection");
  assert.ok(getJournal(run._id).some((j) => j.step === "checkpoint_rejected"));
  // A failed run leaves the directive due; retire it so it does not reopen runs
  // that would hit the real approval store once the resolver resets.
  deleteDirective(d._id);
});

test("checkpoint level none runs autonomously with no checkpoint journal", async () => {
  useLegacyDeterministicPhases();
  const d = mkDirective(); // approvalPolicy defaults to {} → none
  addCriterion(d._id, "criterion A");
  // A resolver that would reject if it were ever consulted for this run.
  _setDirectiveCheckpointResolverForTests(async () => "reject");

  await directiveTick(new Date("2026-06-11T12:20:00Z"));
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T12:20:01Z"));

  assert.equal(getRun(run._id)!.phase, "execute", "none-level run is fully autonomous");
  assert.ok(
    !getJournal(run._id).some((j) => j.step.startsWith("checkpoint_")),
    "no checkpoint gating for a none-level run"
  );
});

test("full checkpoint gates completion: criteria proven only after approval", async () => {
  useLegacyDeterministicPhases();
  const d = mkDirective({ approvalPolicy: { checkpoint: "full" } });
  const c = addCriterion(d._id, "criterion A");

  const gates: Record<string, Decision> = { plan: "approve", completion: "pending" };
  _setDirectiveCheckpointResolverForTests(async ({ gate }) => gates[gate]);

  await directiveTick(new Date("2026-06-11T13:00:00Z")); // open
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T13:00:01Z")); // plan (approve) → execute
  assert.equal(getRun(run._id)!.phase, "execute");

  await completeRunTasks(d._id, run._id, "review");
  await directiveTick(new Date("2026-06-11T13:00:02Z")); // execute → verify
  assert.equal(getRun(run._id)!.phase, "verify");

  await directiveTick(new Date("2026-06-11T13:00:03Z")); // verify — completion held
  assert.equal(getRun(run._id)!.phase, "verify", "held in verify pending completion approval");
  assert.equal(getCriteria(d._id).find((x) => x._id === c._id)!.proven, 0, "criterion unproven while held");
  assert.ok(
    getJournal(run._id).some((j) => j.step === "checkpoint_pending" && j.payload.includes('"gate":"completion"'))
  );

  gates.completion = "approve";
  await directiveTick(new Date("2026-06-11T13:00:04Z")); // verify → reflect
  assert.notEqual(getRun(run._id)!.phase, "verify");
  assert.equal(getCriteria(d._id).find((x) => x._id === c._id)!.proven, 1, "criterion proven after approval");
});

test("full checkpoint completion rejection fails the run with criteria unproven", async () => {
  useLegacyDeterministicPhases();
  const d = mkDirective({ approvalPolicy: { checkpoint: "full" } });
  const c = addCriterion(d._id, "criterion A");
  const gates: Record<string, Decision> = { plan: "approve", completion: "reject" };
  _setDirectiveCheckpointResolverForTests(async ({ gate }) => gates[gate]);

  await directiveTick(new Date("2026-06-11T14:00:00Z"));
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T14:00:01Z")); // plan → execute
  await completeRunTasks(d._id, run._id, "review");
  await directiveTick(new Date("2026-06-11T14:00:02Z")); // execute → verify
  await directiveTick(new Date("2026-06-11T14:00:03Z")); // verify — completion rejected

  assert.equal(getRun(run._id)!.phase, "failed");
  assert.equal(getRun(run._id)!.failReason, "checkpoint_rejected");
  assert.equal(getCriteria(d._id).find((x) => x._id === c._id)!.proven, 0, "rejected outcome leaves criteria unproven");
  assert.ok(
    getJournal(run._id).some((j) => j.step === "checkpoint_rejected" && j.payload.includes('"gate":"completion"'))
  );
  deleteDirective(d._id);
});

test("getRecentTerminalRuns returns finished runs newest-first, excluding active ones", () => {
  const d = mkDirective();
  const r1 = createRun(d._id);
  setRunPhase(r1._id, "done", {
    reflectionText: "Run 1 proved the index criterion.",
    planSummary: "Planned 1 task: refresh index",
    completedAt: "2026-07-01T10:00:00Z",
  });
  const r2 = createRun(d._id);
  setRunPhase(r2._id, "failed", { failReason: "checkpoint_rejected", failedAt: "2026-07-02T10:00:00Z" });
  const r3 = createRun(d._id); // still in plan phase — must not appear

  const recent = getRecentTerminalRuns(d._id, 3);
  assert.equal(recent.length, 2);
  assert.ok(recent.every((r) => r._id !== r3._id));
  assert.equal(recent.some((r) => r.reflectionText?.includes("Run 1 proved")), true);
  deleteDirective(d._id);
});

test("planner prompt carries the directive's run history: prior outcomes + last reflection", async () => {
  const d = mkDirective();
  addCriterion(d._id, "Keep the index fresh");

  // A finished prior episode with a reflection the next planner must see.
  const prior = createRun(d._id);
  setRunPhase(prior._id, "done", {
    reflectionText: "Rebuilding from scratch was wasteful; incremental updates worked.",
    planSummary: "Planned 1 task: rebuild index",
    completedAt: "2026-07-03T10:00:00Z",
  });

  await directiveTick(new Date("2026-07-04T09:00:00Z"));
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-07-04T09:00:01Z"));

  const plannerTask = (await getRunTasks(d._id, run._id)).find(
    (t) => ((t.output ?? {}) as Record<string, unknown>).directivePhase === "planner"
  )!;
  assert.ok(plannerTask, "planner phase task should exist");
  const desc = String(plannerTask.description);
  assert.match(desc, /Previous runs \(newest first\):/);
  assert.match(desc, /incremental updates worked/);
  assert.match(desc, /do not repeat an approach that already failed/);
  deleteDirective(d._id);
});
