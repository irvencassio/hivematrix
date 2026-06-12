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
} = await import("./directive-store");
const {
  directiveTick,
  _setDirectivePlannerForTests,
  _setDirectiveReviewerForTests,
  _setDirectiveRetrospectiveForTests,
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

// Drive a run from plan to done, simulating task completion between ticks.
async function completeRunTasks(directiveId: string, runId: string, status = "review") {
  const tasks = await Task.find({ directiveId });
  for (const t of tasks) {
    const out = (t.output ?? {}) as Record<string, unknown>;
    if (out.runId === runId) {
      await Task.findByIdAndUpdate(t._id.toString(), { status });
    }
  }
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
  const d = mkDirective({ triggerPolicy: { type: "manual" } });
  addCriterion(d._id, "c");

  await directiveTick(new Date("2026-06-11T12:00:00Z"));
  const run = getActiveRuns().find((r) => r.directiveId === d._id)!;
  await directiveTick(new Date("2026-06-11T12:00:01Z")); // plan→execute
  await completeRunTasks(d._id, run._id, "failed"); // failed task ⇒ criterion NOT proven
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

test("reflect phase records retrospective learning paths", async () => {
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
