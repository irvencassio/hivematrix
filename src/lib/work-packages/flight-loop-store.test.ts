import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-loop-store-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { _resetDbForTests, getDb } = await import("@/lib/db");
const {
  getLoop,
  upsertLoop,
  pauseLoop,
  resumeLoop,
  getLoopPasses,
  createPass,
  completePass,
  updateLoopAfterPass,
} = await import("./flight-loop-store");

test.before(() => { _resetDbForTests(); getDb(); });
test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

const PKG_A = "pkg-loop-a";
const PKG_B = "pkg-loop-b";

test("upsertLoop creates a new loop with defaults", () => {
  const loop = upsertLoop(PKG_A, {});
  assert.ok(loop.id);
  assert.equal(loop.packageId, PKG_A);
  assert.equal(loop.mode, "manual");
  assert.equal(loop.profile, "quality");
  assert.equal(loop.status, "idle");
  assert.equal(loop.maxPasses, 3);
  assert.equal(loop.passCount, 0);
  assert.equal(loop.autoCreateItems, true);
  assert.equal(loop.autoReadySafeItems, false);
  assert.ok(loop.expiresAt, "has a default expiry");
  assert.ok(loop.createdAt);
  assert.ok(loop.updatedAt);
});

test("upsertLoop with explicit fields overrides defaults", () => {
  const loop = upsertLoop(PKG_B, {
    mode: "fixed",
    profile: "release",
    maxPasses: 5,
    cadenceSeconds: 600,
    autoCreateItems: false,
    autoReadySafeItems: true,
  });
  assert.equal(loop.mode, "fixed");
  assert.equal(loop.profile, "release");
  assert.equal(loop.maxPasses, 5);
  assert.equal(loop.cadenceSeconds, 600);
  assert.equal(loop.autoCreateItems, false);
  assert.equal(loop.autoReadySafeItems, true);
});

test("upsertLoop on existing loop updates only provided fields", () => {
  const first = upsertLoop(PKG_A, {});
  const updated = upsertLoop(PKG_A, { maxPasses: 6, mode: "self_paced" });
  assert.equal(updated.id, first.id, "same row");
  assert.equal(updated.maxPasses, 6);
  assert.equal(updated.mode, "self_paced");
  assert.equal(updated.profile, first.profile, "unchanged");
});

test("getLoop returns null for unknown packageId", () => {
  assert.equal(getLoop("unknown-pkg-xyz"), null);
});

test("getLoop returns the loop for a known packageId", () => {
  upsertLoop("pkg-get-test", { maxPasses: 2 });
  const loop = getLoop("pkg-get-test");
  assert.ok(loop);
  assert.equal(loop!.maxPasses, 2);
});

test("pauseLoop sets status to paused", () => {
  upsertLoop("pkg-pause", {});
  const paused = pauseLoop("pkg-pause");
  assert.ok(paused);
  assert.equal(paused!.status, "paused");
  assert.equal(paused!.stopReason, "manually_paused");
});

test("pauseLoop returns null for unknown packageId", () => {
  assert.equal(pauseLoop("no-such-pkg"), null);
});

test("pauseLoop returns null if already paused", () => {
  upsertLoop("pkg-pause2", {});
  pauseLoop("pkg-pause2");
  assert.equal(pauseLoop("pkg-pause2"), null);
});

test("pauseLoop returns null if loop is stopped", () => {
  upsertLoop("pkg-stopped", {});
  updateLoopAfterPass("ignored", 3, "stopped", "max_passes_reached", null);
  // reach stopped via updateLoopAfterPass on the real loop id
  const loop = getLoop("pkg-stopped")!;
  getDb().prepare("UPDATE flight_loops SET status = 'stopped' WHERE _id = ?").run(loop.id);
  assert.equal(pauseLoop("pkg-stopped"), null);
});

test("resumeLoop restores manual loop to idle", () => {
  upsertLoop("pkg-resume-manual", { mode: "manual" });
  pauseLoop("pkg-resume-manual");
  const resumed = resumeLoop("pkg-resume-manual");
  assert.ok(resumed);
  assert.equal(resumed!.status, "idle");
  assert.equal(resumed!.stopReason, null);
});

test("resumeLoop restores fixed loop to active", () => {
  upsertLoop("pkg-resume-fixed", { mode: "fixed", cadenceSeconds: 60 });
  pauseLoop("pkg-resume-fixed");
  const resumed = resumeLoop("pkg-resume-fixed");
  assert.ok(resumed);
  assert.equal(resumed!.status, "active");
});

test("resumeLoop returns null for non-paused loop", () => {
  upsertLoop("pkg-resume-idle", {});
  assert.equal(resumeLoop("pkg-resume-idle"), null);
});

test("createPass + completePass persist a full pass record", () => {
  const loop = upsertLoop("pkg-pass-test", { maxPasses: 2 });
  const pass = createPass(loop.id, "pkg-pass-test", "quality", 1);
  assert.ok(pass.id);
  assert.equal(pass.status, "running");
  assert.equal(pass.passNumber, 1);
  assert.equal(pass.loopId, loop.id);
  assert.equal(pass.completedAt, null);

  const done = completePass(pass.id, {
    status: "completed",
    summary: "1/2 items done; 1 failed; 1 follow-up item created",
    evidence: { counts: { done: 1, failed: 1 } },
    createdItemIds: ["item-x"],
    stopReason: null,
  });
  assert.equal(done.status, "completed");
  assert.ok(done.completedAt);
  assert.ok(done.summary?.includes("1/2 items done"));
  assert.deepEqual(done.evidence, { counts: { done: 1, failed: 1 } });
  assert.deepEqual(done.createdItemIds, ["item-x"]);
});

test("getLoopPasses returns passes newest-first", () => {
  const loop = upsertLoop("pkg-passes-order", { maxPasses: 5 });
  const p1 = createPass(loop.id, "pkg-passes-order", "quality", 1);
  completePass(p1.id, { status: "completed", summary: "pass 1", evidence: {}, createdItemIds: [], stopReason: null });
  const p2 = createPass(loop.id, "pkg-passes-order", "quality", 2);
  completePass(p2.id, { status: "completed", summary: "pass 2", evidence: {}, createdItemIds: [], stopReason: null });

  const passes = getLoopPasses(loop.id);
  assert.equal(passes.length, 2);
  assert.equal(passes[0].passNumber, 2, "newest first");
  assert.equal(passes[1].passNumber, 1);
});

test("updateLoopAfterPass increments passCount and sets next status", () => {
  const loop = upsertLoop("pkg-after-pass", { maxPasses: 3 });
  updateLoopAfterPass(loop.id, 1, "idle", null, null);
  const updated = getLoop("pkg-after-pass")!;
  assert.equal(updated.passCount, 1);
  assert.equal(updated.status, "idle");
  assert.equal(updated.stopReason, null);
});

test("updateLoopAfterPass can mark loop stopped with reason", () => {
  const loop = upsertLoop("pkg-stop-reason", { maxPasses: 1 });
  updateLoopAfterPass(loop.id, 1, "stopped", "max_passes_reached", null);
  const updated = getLoop("pkg-stop-reason")!;
  assert.equal(updated.status, "stopped");
  assert.equal(updated.stopReason, "max_passes_reached");
});

test("updateLoopAfterPass stores nextRunAt for fixed mode", () => {
  const loop = upsertLoop("pkg-next-run", { mode: "fixed", cadenceSeconds: 300 });
  const nextRun = new Date(Date.now() + 300_000).toISOString();
  updateLoopAfterPass(loop.id, 1, "active", null, nextRun);
  const updated = getLoop("pkg-next-run")!;
  assert.ok(updated.nextRunAt, "nextRunAt set");
  assert.equal(updated.status, "active");
});

// --- Loop policy: default and explicit expiry ---

test("upsertLoop default expiresAt is approximately 7 days from now", () => {
  const before = Date.now();
  const loop = upsertLoop("pkg-default-expiry", {});
  const after = Date.now();
  const expectedMs = 7 * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(loop.expiresAt!).getTime();
  assert.ok(expiresAt >= before + expectedMs - 1000, "expiresAt is at least ~7 days from now");
  assert.ok(expiresAt <= after + expectedMs + 1000, "expiresAt is not more than ~7 days + 1s from now");
});

test("upsertLoop with explicit expiresAt: null stores no expiry", () => {
  const loop = upsertLoop("pkg-no-expiry", { expiresAt: null });
  assert.equal(loop.expiresAt, null, "null expiresAt stored as null — loop never expires");
});

test("upsertLoop updating expiresAt to null on existing loop clears expiry", () => {
  upsertLoop("pkg-clear-expiry", {});
  const cleared = upsertLoop("pkg-clear-expiry", { expiresAt: null });
  assert.equal(cleared.expiresAt, null, "existing loop expiry cleared to null on update");
});

// --- Loop policy: pauseLoop edge cases ---

test("pauseLoop returns null when loop is running (a pass holds the lock)", () => {
  upsertLoop("pkg-pause-running", {});
  const loop = getLoop("pkg-pause-running")!;
  getDb().prepare("UPDATE flight_loops SET status = 'running' WHERE _id = ?").run(loop.id);
  assert.equal(pauseLoop("pkg-pause-running"), null);
});

// --- Pass record: error field ---

test("completePass stores error field when status is failed", () => {
  const loop = upsertLoop("pkg-fail-pass", { maxPasses: 2 });
  const pass = createPass(loop.id, "pkg-fail-pass", "quality", 1);
  const done = completePass(pass.id, {
    status: "failed",
    summary: null,
    evidence: {},
    createdItemIds: [],
    stopReason: null,
    error: "something went wrong internally",
  });
  assert.equal(done.status, "failed");
  assert.equal(done.error, "something went wrong internally");
  assert.ok(done.completedAt !== null, "completedAt is set even on failed pass");
  assert.equal(done.summary, null);
});

test("completePass with no error field stores null", () => {
  const loop = upsertLoop("pkg-ok-pass", { maxPasses: 2 });
  const pass = createPass(loop.id, "pkg-ok-pass", "quality", 1);
  const done = completePass(pass.id, {
    status: "completed",
    summary: "all good",
    evidence: {},
    createdItemIds: [],
    stopReason: null,
  });
  assert.equal(done.error, null);
});
