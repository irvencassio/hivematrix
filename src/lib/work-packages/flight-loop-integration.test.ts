/**
 * End-to-end integration tests: flight creation → self-paced loop → item readiness.
 *
 * These tests wire together the full stack — store, scheduler, pass runner, and
 * follow-up creator — to verify multi-component flows that unit tests cannot cover.
 * Each test owns its package ids; the shared DB is reset once at startup.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-loop-e2e-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { _resetDbForTests, getDb } = await import("@/lib/db");
const { createWorkPackage, getWorkPackage, updateWorkPackageItem } = await import("./store");
const {
  upsertLoop,
  getLoop,
  getLoopPasses,
  notifySelfPacedLoop,
  pauseLoop,
  resumeLoop,
} = await import("./flight-loop-store");
const { runPass } = await import("./flight-loop-pass");
const { tickFlightLoops } = await import("./flight-loop-scheduler");

test.before(() => { _resetDbForTests(); getDb(); });
test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function makePackage(title: string, projectPath = "/tmp/e2e-test") {
  return createWorkPackage({
    title,
    project: "e2e",
    projectPath,
    items: [
      { title: "Step A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      { title: "Step B", prompt: "Do B", risk: "medium", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
}

/** Set nextRunAt to the past so tickFlightLoops picks the loop up immediately. */
function setNextRunInPast(packageId: string) {
  const past = new Date(Date.now() - 1000).toISOString();
  getDb().prepare("UPDATE flight_loops SET nextRunAt = ? WHERE packageId = ?").run(past, packageId);
}

// ── 1. Self-paced loop: item completion triggers notify → tick → pass ─────────

test("item-done transition → notifySelfPacedLoop → tick fires one pass", async () => {
  const pkg = makePackage("E2E: item-done triggers pass");
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 5, autoCreateItems: false });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "running" });

  // Simulate item-complete event triggering the hook.
  notifySelfPacedLoop(pkg.id);

  const loopBefore = getLoop(pkg.id)!;
  assert.ok(loopBefore.nextRunAt, "notifySelfPacedLoop set nextRunAt");

  await tickFlightLoops();

  const loop = getLoop(pkg.id)!;
  const passes = getLoopPasses(loop.id);
  assert.ok(passes.length >= 1, "at least one pass ran after tick");
  assert.equal(passes[0].packageId, pkg.id);
  assert.equal(passes[0].status, "completed");
  // After a non-stopped self_paced pass, nextRunAt is cleared until next event.
  if (loop.status !== "stopped") {
    assert.equal(loop.nextRunAt, null, "nextRunAt reset after self_paced pass");
  }
});

// ── 2. All items done → pass stops with all_checks_clean ─────────────────────

test("all items done → self_paced pass stops with all_checks_clean", async () => {
  const pkg = makePackage("E2E: all-done all_checks_clean");
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 5 });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });
  updateWorkPackageItem(pkg.id, pkg.items[1].id, { status: "done" });

  notifySelfPacedLoop(pkg.id);
  await tickFlightLoops();

  const loop = getLoop(pkg.id)!;
  assert.equal(loop.status, "stopped");
  assert.equal(loop.stopReason, "all_checks_clean");
  const passes = getLoopPasses(loop.id);
  assert.equal(passes[0].stopReason, "all_checks_clean");
});

// ── 3. Failed item → follow-up created → follow-up done → all_checks_clean ───

test("failed item → follow-up created, follow-up resolves → all_checks_clean", async () => {
  const pkg = makePackage("E2E: failure→follow-up→clean");
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 10, autoCreateItems: true, autoReadySafeItems: false });

  // First pass: item fails, follow-up created.
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "failed", blocker: "compile error" });
  notifySelfPacedLoop(pkg.id);
  await tickFlightLoops();

  const loop = getLoop(pkg.id)!;
  assert.notEqual(loop.status, "stopped", "loop keeps running after first pass with follow-up");
  const pass1 = getLoopPasses(loop.id)[0];
  assert.ok(pass1.createdItemIds.length >= 1, "follow-up item created");

  // The follow-up item should be in the package as draft.
  const detailAfterPass1 = getWorkPackage(pkg.id)!;
  const followUp = detailAfterPass1.items.find((i) => pass1.createdItemIds.includes(i.id))!;
  assert.ok(followUp, "follow-up item visible in package");
  assert.equal(followUp.status, "draft");
  assert.ok(followUp.title.includes("Re-examine"), "follow-up title signals re-examination");

  // Mark all items done (original + follow-up), then fire the next pass.
  for (const item of detailAfterPass1.items) {
    updateWorkPackageItem(pkg.id, item.id, { status: "done" });
  }
  notifySelfPacedLoop(pkg.id);
  await tickFlightLoops();

  const loopFinal = getLoop(pkg.id)!;
  assert.equal(loopFinal.status, "stopped");
  assert.equal(loopFinal.stopReason, "all_checks_clean");
});

// ── 4. Pause gate: scheduler skips paused loop ───────────────────────────────

test("paused loop is not triggered by tick; resumed loop is", async () => {
  const pkg = makePackage("E2E: pause/resume gate");
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 5, autoCreateItems: false });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "running" });

  notifySelfPacedLoop(pkg.id);
  const loopAfterNotify = getLoop(pkg.id)!;
  assert.ok(loopAfterNotify.nextRunAt, "nextRunAt set before pause");

  // Pause the loop before the tick.
  pauseLoop(pkg.id);

  await tickFlightLoops();

  const loopAfterPausedTick = getLoop(pkg.id)!;
  const passesAfterPausedTick = getLoopPasses(loopAfterPausedTick.id);
  assert.equal(passesAfterPausedTick.length, 0, "no pass ran while loop was paused");

  // Resume and re-notify so the scheduler picks it up.
  resumeLoop(pkg.id);
  notifySelfPacedLoop(pkg.id);
  await tickFlightLoops();

  const loopAfterResume = getLoop(pkg.id)!;
  const passesAfterResume = getLoopPasses(loopAfterResume.id);
  assert.ok(passesAfterResume.length >= 1, "pass ran after resume + tick");
});

// ── 5. Fixed-cadence: scheduler re-schedules nextRunAt after each pass ────────

test("fixed-cadence loop: tick fires pass, nextRunAt advanced, second tick skips", async () => {
  const pkg = makePackage("E2E: fixed-cadence scheduling");
  upsertLoop(pkg.id, { mode: "fixed", cadenceSeconds: 60, maxPasses: 5, autoCreateItems: false });
  // Keep a running item so the pass doesn't stop with no_actionable_follow_up.
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "running" });
  // Advance the loop to active + past nextRunAt to simulate first scheduled fire.
  const loop = getLoop(pkg.id)!;
  const past = new Date(Date.now() - 1000).toISOString();
  getDb().prepare("UPDATE flight_loops SET nextRunAt = ?, status = 'active' WHERE _id = ?").run(past, loop.id);

  // First tick: fires a pass.
  await tickFlightLoops();

  const loopAfter1 = getLoop(pkg.id)!;
  assert.ok(getLoopPasses(loopAfter1.id).length >= 1, "first pass ran");
  assert.ok(loopAfter1.nextRunAt, "nextRunAt set after fixed-mode pass");
  const nextRun = new Date(loopAfter1.nextRunAt!).getTime();
  assert.ok(nextRun > Date.now(), "nextRunAt is in the future after pass");

  const passesBefore = getLoopPasses(loopAfter1.id).length;

  // Second immediate tick: nextRunAt is still in the future — no pass.
  await tickFlightLoops();
  const passesAfter = getLoopPasses(loopAfter1.id).length;
  assert.equal(passesAfter, passesBefore, "second tick skips when nextRunAt is in the future");
});

// ── 6. Expiry: loop is stopped on next tick after expiresAt passes ────────────

test("expired loop: tickFlightLoops stops it, subsequent runPass rejects", async () => {
  const pkg = makePackage("E2E: expiry stops loop");
  const futureExpiry = new Date(Date.now() + 60_000).toISOString();
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 5, expiresAt: futureExpiry });
  setNextRunInPast(pkg.id);

  // Advance expiry into the past to simulate time passing.
  const past = new Date(Date.now() - 1000).toISOString();
  getDb().prepare("UPDATE flight_loops SET expiresAt = ? WHERE packageId = ?").run(past, pkg.id);

  await tickFlightLoops();

  const loop = getLoop(pkg.id)!;
  assert.equal(loop.status, "stopped");
  assert.equal(loop.stopReason, "expired");
  assert.equal(getLoopPasses(loop.id).length, 0, "no pass ran — expiry check beats pass trigger");

  // Direct runPass must also reject.
  await assert.rejects(() => runPass(pkg.id), /loop is stopped/);
});

// ── 7. Multi-notify coalesces into one pass per tick ─────────────────────────

test("multiple notifySelfPacedLoop calls before tick result in exactly one pass", async () => {
  const pkg = makePackage("E2E: notify coalesces");
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 5, autoCreateItems: false });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "running" });

  // Three rapid notifications (e.g. three items completed close together).
  notifySelfPacedLoop(pkg.id);
  notifySelfPacedLoop(pkg.id);
  notifySelfPacedLoop(pkg.id);

  const loopAfterNotify = getLoop(pkg.id)!;
  assert.ok(loopAfterNotify.nextRunAt, "nextRunAt is set after first notify");

  await tickFlightLoops();

  const loop = getLoop(pkg.id)!;
  // Exactly one pass should have run — the atomic lock absorbs concurrent attempts.
  assert.equal(getLoopPasses(loop.id).length, 1, "exactly one pass ran despite multiple notifications");
});

// ── 8. passCount increments across sequential self-paced passes ───────────────

test("passCount increments one per notify→tick cycle; loop stops at maxPasses", async () => {
  const pkg = makePackage("E2E: passCount sequence");
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 3, autoCreateItems: false });
  // Keep item running so no early stop.
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "running" });

  for (let expected = 1; expected <= 3; expected++) {
    notifySelfPacedLoop(pkg.id);
    await tickFlightLoops();
    const loop = getLoop(pkg.id)!;
    if (loop.status === "stopped") {
      assert.equal(loop.passCount, expected);
      assert.equal(loop.stopReason, "max_passes_reached");
      break;
    }
    assert.equal(loop.passCount, expected, `passCount after cycle ${expected}`);
  }

  const finalLoop = getLoop(pkg.id)!;
  assert.equal(finalLoop.status, "stopped");
  assert.equal(finalLoop.passCount, 3);
  assert.equal(finalLoop.stopReason, "max_passes_reached");
});

// ── 9. autoReadySafeItems=true: low-risk follow-up is auto-promoted to ready ─

test("autoReadySafeItems=true: low-risk follow-up created as ready", async () => {
  const pkg = makePackage("E2E: auto-ready low-risk");
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 5, autoCreateItems: true, autoReadySafeItems: true });
  // items[0] has risk: "low"
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "failed", blocker: "lint error" });

  notifySelfPacedLoop(pkg.id);
  await tickFlightLoops();

  const loop = getLoop(pkg.id)!;
  const pass = getLoopPasses(loop.id)[0];
  assert.ok(pass.createdItemIds.length >= 1, "follow-up item created");

  const detail = getWorkPackage(pkg.id)!;
  const followUp = detail.items.find((i) => pass.createdItemIds.includes(i.id))!;
  assert.ok(followUp, "follow-up exists in package");
  assert.equal(followUp.status, "ready", "low-risk follow-up auto-promoted to ready");
  assert.equal(followUp.risk, "low");
});

// ── 10. High-risk follow-up is held regardless of autoReadySafeItems ──────────

test("high-risk follow-up is always held, blocking loop with risky_action_held", async () => {
  const pkg = createWorkPackage({
    title: "E2E: high-risk held",
    project: "e2e",
    projectPath: "/tmp/e2e-test",
    items: [
      { title: "Deploy prod", prompt: "Push release", risk: "high", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
  // Even with autoReadySafeItems=true, high-risk must be held.
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 5, autoCreateItems: true, autoReadySafeItems: true });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "failed", blocker: "auth error" });

  notifySelfPacedLoop(pkg.id);
  await tickFlightLoops();

  const loop = getLoop(pkg.id)!;
  // The pass state is "risky" due to the held item from the original high-risk item status,
  // but since we set it to failed (not held), the follow-up itself will be held.
  const pass = getLoopPasses(loop.id)[0];
  assert.ok(pass.createdItemIds.length >= 1, "follow-up created");

  const detail = getWorkPackage(pkg.id)!;
  const followUp = detail.items.find((i) => pass.createdItemIds.includes(i.id))!;
  assert.equal(followUp.status, "held", "high-risk follow-up must be held for operator gate");
  assert.equal(followUp.risk, "high");
});

// ── 11. Gate failure prevents all_checks_clean; creates gate fix item ─────────

test("failing repo gate blocks all_checks_clean and creates fix item", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-e2e-gate-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      scripts: { typecheck: "node -e \"process.exit(1)\"" },
    }));
    const pkg = createWorkPackage({
      title: "E2E: gate-fail blocks clean",
      project: "e2e",
      projectPath: dir,
      items: [
        { title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      ],
    });
    upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 5, autoCreateItems: true });
    updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });

    notifySelfPacedLoop(pkg.id);
    await tickFlightLoops();

    const loop = getLoop(pkg.id)!;
    const pass = getLoopPasses(loop.id)[0];
    assert.notEqual(pass.stopReason, "all_checks_clean", "failing gate prevents clean stop");
    assert.ok(pass.createdItemIds.length >= 1, "gate fix item created");

    const detail = getWorkPackage(pkg.id)!;
    const gateItem = detail.items.find((i) => pass.createdItemIds.includes(i.id))!;
    assert.ok(gateItem.title.toLowerCase().includes("typecheck"), "gate fix item title references gate name");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 12. Gate passes + all items done → all_checks_clean via tick ──────────────

test("passing gate + all items done → all_checks_clean via notifiy→tick pipeline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-e2e-gate-ok-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      scripts: { typecheck: "node -e \"process.exit(0)\"" },
    }));
    const pkg = createWorkPackage({
      title: "E2E: gate-pass + items-done = clean",
      project: "e2e",
      projectPath: dir,
      items: [
        { title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      ],
    });
    upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 5 });
    updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });

    notifySelfPacedLoop(pkg.id);
    await tickFlightLoops();

    const loop = getLoop(pkg.id)!;
    assert.equal(loop.status, "stopped");
    assert.equal(loop.stopReason, "all_checks_clean");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 13. Terminal flight stops loop at tick time ───────────────────────────────

test("flight marked done stops self_paced loop on next tick without running a pass", async () => {
  const { updateWorkPackage } = await import("./store");
  const pkg = makePackage("E2E: terminal flight stops loop");
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 5 });

  // Set nextRunAt to past (loop is due to fire).
  setNextRunInPast(pkg.id);
  // Mark the flight itself as done (e.g. operator closed it).
  updateWorkPackage(pkg.id, { status: "done" });

  await tickFlightLoops();

  const loop = getLoop(pkg.id)!;
  assert.equal(loop.status, "stopped");
  assert.equal(loop.stopReason, "flight_complete");
  assert.equal(getLoopPasses(loop.id).length, 0, "no pass ran — terminal flight short-circuits tick");
});

// ── 14. runPass → pass history is queryable and evidence is well-formed ────────

test("pass history and evidence structure are well-formed after full e2e pass", async () => {
  const pkg = makePackage("E2E: pass history + evidence");
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 5, autoCreateItems: false });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "running" });

  notifySelfPacedLoop(pkg.id);
  await tickFlightLoops();

  const loop = getLoop(pkg.id)!;
  const passes = getLoopPasses(loop.id);
  assert.ok(passes.length >= 1);

  const pass = passes[0];
  assert.equal(pass.loopId, loop.id);
  assert.equal(pass.packageId, pkg.id);
  assert.equal(pass.passNumber, 1);
  assert.ok(pass.startedAt, "startedAt set");
  assert.ok(pass.completedAt, "completedAt set");
  assert.ok(pass.summary, "summary is non-empty");

  const evidence = pass.evidence as Record<string, unknown>;
  assert.ok("counts" in evidence, "evidence.counts present");
  assert.ok("state" in evidence, "evidence.state present");
  assert.ok("blockedItemCount" in evidence, "evidence.blockedItemCount present");
  assert.equal(typeof evidence.blockedItemCount, "number");
  const validStates = ["clean", "needs_follow_up", "blocked", "risky", "running"];
  assert.ok(validStates.includes(evidence.state as string), `evidence.state is valid (got: ${evidence.state})`);
});

// ── 15. self_paced → manual: notifySelfPacedLoop becomes no-op after mode change

test("switching loop to manual makes notifySelfPacedLoop a no-op", async () => {
  const pkg = makePackage("E2E: mode change blocks notify");
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 5, autoCreateItems: false });

  // Change to manual.
  upsertLoop(pkg.id, { mode: "manual" });

  notifySelfPacedLoop(pkg.id);

  const loop = getLoop(pkg.id)!;
  assert.equal(loop.nextRunAt, null, "manual loop must not get nextRunAt from notifySelfPacedLoop");

  // Tick must not run any pass for this loop.
  await tickFlightLoops();
  assert.equal(getLoopPasses(loop.id).length, 0, "no pass ran for manual loop after notify");
});
