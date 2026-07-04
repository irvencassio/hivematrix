import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-loop-sched-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { _resetDbForTests, getDb } = await import("@/lib/db");
const { createWorkPackage, updateWorkPackage } = await import("./store");
const {
  upsertLoop,
  getLoop,
  getLoopPasses,
  notifySelfPacedLoop,
} = await import("./flight-loop-store");
const { tickFlightLoops } = await import("./flight-loop-scheduler");

test.before(() => { _resetDbForTests(); getDb(); });
test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

function makePackage(title: string) {
  return createWorkPackage({
    title,
    project: "test",
    projectPath: "/tmp/test",
    items: [
      { title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
}

// ── notifySelfPacedLoop ──────────────────────────────────────────────────────

test("notifySelfPacedLoop sets nextRunAt for a self_paced idle loop", () => {
  const pkg = makePackage("Self-paced notify pkg");
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 3 });

  const before = Date.now();
  notifySelfPacedLoop(pkg.id);
  const after = Date.now();

  const loop = getLoop(pkg.id)!;
  assert.ok(loop.nextRunAt, "nextRunAt should be set");
  const ts = new Date(loop.nextRunAt!).getTime();
  assert.ok(ts >= before - 5, "nextRunAt is approximately now (before)");
  assert.ok(ts <= after + 5, "nextRunAt is approximately now (after)");
});

test("notifySelfPacedLoop does nothing for manual mode loop", () => {
  const pkg = makePackage("Manual notify pkg");
  upsertLoop(pkg.id, { mode: "manual", maxPasses: 3 });

  notifySelfPacedLoop(pkg.id);

  const loop = getLoop(pkg.id)!;
  assert.equal(loop.nextRunAt, null, "manual loops are never auto-scheduled");
});

test("notifySelfPacedLoop does nothing for fixed mode loop", () => {
  const pkg = makePackage("Fixed notify pkg");
  upsertLoop(pkg.id, { mode: "fixed", cadenceSeconds: 60, maxPasses: 3 });

  notifySelfPacedLoop(pkg.id);

  const loop = getLoop(pkg.id)!;
  assert.equal(loop.nextRunAt, null, "notifySelfPacedLoop only targets self_paced loops");
});

test("notifySelfPacedLoop does nothing when loop is stopped", () => {
  const pkg = makePackage("Stopped notify pkg");
  const loop = upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 3 });
  getDb().prepare("UPDATE flight_loops SET status = 'stopped' WHERE _id = ?").run(loop.id);

  notifySelfPacedLoop(pkg.id);

  const updated = getLoop(pkg.id)!;
  assert.equal(updated.nextRunAt, null, "stopped loops must not be re-scheduled");
});

test("notifySelfPacedLoop does nothing when loop is paused", () => {
  const pkg = makePackage("Paused notify pkg");
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 3 });
  getDb().prepare("UPDATE flight_loops SET status = 'paused' WHERE _id = ?")
    .run(getLoop(pkg.id)!.id);

  notifySelfPacedLoop(pkg.id);

  const updated = getLoop(pkg.id)!;
  assert.equal(updated.nextRunAt, null, "paused loops must not be re-scheduled");
});

// ── tickFlightLoops — expiry ─────────────────────────────────────────────────

test("tickFlightLoops marks expired loops stopped", async () => {
  const pkg = makePackage("Expired-sched pkg");
  const past = new Date(Date.now() - 1000).toISOString();
  upsertLoop(pkg.id, { maxPasses: 3 });
  getDb()
    .prepare("UPDATE flight_loops SET expiresAt = ? WHERE packageId = ?")
    .run(past, pkg.id);

  await tickFlightLoops();

  const loop = getLoop(pkg.id)!;
  assert.equal(loop.status, "stopped");
  assert.equal(loop.stopReason, "expired");
});

test("tickFlightLoops marks paused loops stopped on expiry", async () => {
  const pkg = makePackage("Paused-expired pkg");
  const past = new Date(Date.now() - 1000).toISOString();
  upsertLoop(pkg.id, { maxPasses: 3 });
  getDb()
    .prepare("UPDATE flight_loops SET expiresAt = ?, status = 'paused' WHERE packageId = ?")
    .run(past, pkg.id);

  await tickFlightLoops();

  const loop = getLoop(pkg.id)!;
  assert.equal(loop.status, "stopped");
  assert.equal(loop.stopReason, "expired");
});

// ── tickFlightLoops — terminal Flight ────────────────────────────────────────

test("tickFlightLoops stops loop when Flight is done", async () => {
  const pkg = makePackage("Terminal-flight pkg");
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 5 });

  // Set nextRunAt to past so the loop is "due"
  const past = new Date(Date.now() - 1000).toISOString();
  getDb()
    .prepare("UPDATE flight_loops SET nextRunAt = ? WHERE packageId = ?")
    .run(past, pkg.id);

  // Mark the Flight as done
  updateWorkPackage(pkg.id, { status: "done" });

  await tickFlightLoops();

  const loop = getLoop(pkg.id)!;
  assert.equal(loop.status, "stopped");
  assert.equal(loop.stopReason, "flight_complete");
});

test("tickFlightLoops stops loop when Flight is failed", async () => {
  const pkg = makePackage("Failed-flight pkg");
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 5 });
  const past = new Date(Date.now() - 1000).toISOString();
  getDb()
    .prepare("UPDATE flight_loops SET nextRunAt = ? WHERE packageId = ?")
    .run(past, pkg.id);
  updateWorkPackage(pkg.id, { status: "failed" });

  await tickFlightLoops();

  const loop = getLoop(pkg.id)!;
  assert.equal(loop.status, "stopped");
  assert.equal(loop.stopReason, "flight_complete");
});

// ── tickFlightLoops — manual loop not triggered ──────────────────────────────

test("tickFlightLoops does not trigger manual loops (nextRunAt=null)", async () => {
  const pkg = makePackage("Manual-sched pkg");
  upsertLoop(pkg.id, { mode: "manual", maxPasses: 3 });

  await tickFlightLoops();

  const loop = getLoop(pkg.id)!;
  const passes = getLoopPasses(loop.id);
  assert.equal(passes.length, 0, "manual loop must not be auto-triggered");
  assert.equal(loop.status, "idle", "status unchanged");
});

// ── tickFlightLoops — self-paced loop triggered via notifySelfPacedLoop ──────

test("tickFlightLoops fires a pass for a self_paced loop after notifySelfPacedLoop", async () => {
  const pkg = makePackage("Self-paced-trigger pkg");
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 5, autoCreateItems: false });

  // Simulate event: child item transitioned
  notifySelfPacedLoop(pkg.id);

  // nextRunAt is now set to ~now; tick should pick it up
  await tickFlightLoops();

  const loop = getLoop(pkg.id)!;
  const passes = getLoopPasses(loop.id);
  assert.ok(passes.length >= 1, "at least one pass ran");
  assert.equal(passes[0].packageId, pkg.id);
});

// ── tickFlightLoops — fixed-cadence loop triggered by scheduler ──────────────

test("tickFlightLoops fires a pass for a fixed-cadence loop with due nextRunAt", async () => {
  const pkg = makePackage("Fixed-sched pkg");
  upsertLoop(pkg.id, { mode: "fixed", cadenceSeconds: 60, maxPasses: 5, autoCreateItems: false });

  // Put an item in running state so the pass does not stop with no_actionable_follow_up.
  // A "running" item means the loop continues (state=running, stopReason=null).
  getDb()
    .prepare("UPDATE work_package_items SET status = 'running' WHERE packageId = ?")
    .run(pkg.id);

  // Manually set nextRunAt to past and status to active (as runPass would leave it)
  const past = new Date(Date.now() - 1000).toISOString();
  const loop = getLoop(pkg.id)!;
  getDb()
    .prepare("UPDATE flight_loops SET nextRunAt = ?, status = 'active' WHERE _id = ?")
    .run(past, loop.id);

  await tickFlightLoops();

  const updated = getLoop(pkg.id)!;
  const passes = getLoopPasses(updated.id);
  assert.ok(passes.length >= 1, "at least one pass ran for fixed loop");
  // After a non-stopped pass, runPass sets nextRunAt to now + cadenceSeconds
  assert.ok(updated.nextRunAt, "nextRunAt re-set for next cadence");
  const nextRun = new Date(updated.nextRunAt!).getTime();
  assert.ok(nextRun > Date.now(), "nextRunAt is in the future");
});

// ── tickFlightLoops — not-yet-due loop skipped ──────────────────────────────

test("tickFlightLoops skips loops whose nextRunAt is in the future", async () => {
  const pkg = makePackage("Future-sched pkg");
  upsertLoop(pkg.id, { mode: "fixed", cadenceSeconds: 600, maxPasses: 5 });
  const future = new Date(Date.now() + 600_000).toISOString();
  const loop = getLoop(pkg.id)!;
  getDb()
    .prepare("UPDATE flight_loops SET nextRunAt = ?, status = 'active' WHERE _id = ?")
    .run(future, loop.id);

  await tickFlightLoops();

  const passes = getLoopPasses(loop.id);
  assert.equal(passes.length, 0, "future loop must not fire yet");
});

// ── tickFlightLoops — max passes already exhausted at tick time ──────────────

test("tickFlightLoops gracefully handles a loop already at max passes", async () => {
  const pkg = makePackage("Maxed-sched pkg");
  const loop = upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 1 });

  // Already at maxPasses — simulate prior pass that didn't update status yet
  const past = new Date(Date.now() - 1000).toISOString();
  getDb()
    .prepare("UPDATE flight_loops SET nextRunAt = ?, passCount = 1 WHERE _id = ?")
    .run(past, loop.id);

  // tickFlightLoops calls runPass which throws "max passes reached" → caught silently
  await assert.doesNotReject(() => tickFlightLoops());
});

// ── tickFlightLoops — stopped loop not re-triggered ─────────────────────────

test("tickFlightLoops ignores stopped loops even if they have a stale nextRunAt", async () => {
  const pkg = makePackage("Stopped-sched pkg");
  const loop = upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 3 });
  const past = new Date(Date.now() - 1000).toISOString();
  getDb()
    .prepare("UPDATE flight_loops SET nextRunAt = ?, status = 'stopped' WHERE _id = ?")
    .run(past, loop.id);

  await tickFlightLoops();

  const passes = getLoopPasses(loop.id);
  assert.equal(passes.length, 0, "stopped loops must not run");
});

// ── updateLoopAfterPass nextRunAt cleared for self_paced after pass ──────────

test("after a self_paced pass completes, nextRunAt is null until next event", async () => {
  const pkg = makePackage("Self-paced-reset pkg");
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 5, autoCreateItems: false });
  notifySelfPacedLoop(pkg.id);

  await tickFlightLoops();

  const loop = getLoop(pkg.id)!;
  if (loop.status !== "stopped") {
    // For a non-stopped self_paced loop, nextRunAt should be null (no pending event)
    assert.equal(loop.nextRunAt, null, "self_paced loop nextRunAt cleared after pass");
  }
});

// ── tickFlightLoops — cancelled Flight ──────────────────────────────────────

test("tickFlightLoops stops loop when Flight is cancelled", async () => {
  const pkg = makePackage("Cancelled-flight pkg");
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 5 });
  const past = new Date(Date.now() - 1000).toISOString();
  getDb()
    .prepare("UPDATE flight_loops SET nextRunAt = ? WHERE packageId = ?")
    .run(past, pkg.id);
  updateWorkPackage(pkg.id, { status: "cancelled" });

  await tickFlightLoops();

  const loop = getLoop(pkg.id)!;
  assert.equal(loop.status, "stopped");
  assert.equal(loop.stopReason, "flight_complete");
});

// ── tickFlightLoops — skipped pass for held Flight ──────────────────────────

test("tickFlightLoops writes skipped pass for held-Flight loop without incrementing passCount", async () => {
  const pkg = makePackage("Held-flight-sched pkg");
  getDb().prepare("UPDATE work_packages SET status = 'held' WHERE _id = ?").run(pkg.id);
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 5 });

  const past = new Date(Date.now() - 1000).toISOString();
  const loop = getLoop(pkg.id)!;
  getDb().prepare("UPDATE flight_loops SET nextRunAt = ? WHERE _id = ?").run(past, loop.id);

  await tickFlightLoops();

  const updatedLoop = getLoop(pkg.id)!;
  const passes = getLoopPasses(updatedLoop.id);
  assert.ok(passes.length >= 1, "a skipped pass record was written");
  assert.equal(passes[0].status, "skipped", "pass status is skipped");
  assert.equal(passes[0].stopReason, "skipped_flight_not_ready");
  assert.equal(updatedLoop.passCount, 0, "passCount not incremented");
  assert.notEqual(updatedLoop.status, "stopped", "loop not stopped by a skip");
});

// ── tickFlightLoops — null expiresAt never triggers expiry ──────────────────

test("tickFlightLoops does not mark stopped a loop with null expiresAt", async () => {
  const pkg = makePackage("No-expiry sched pkg");
  upsertLoop(pkg.id, { expiresAt: null, maxPasses: 5 });

  const loop = getLoop(pkg.id)!;
  assert.equal(loop.expiresAt, null, "precondition: expiresAt is null");

  await tickFlightLoops();

  const after = getLoop(pkg.id)!;
  assert.notEqual(after.status, "stopped", "null expiresAt loop must not be stopped by expiry check");
});
