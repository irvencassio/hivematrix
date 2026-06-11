import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
const { directiveTick } = await import("./directive-engine");

// Fresh DB for this file.
_resetDbForTests();
getDb();

test.after(() => {
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
