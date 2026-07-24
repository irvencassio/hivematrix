import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";

// Isolate the DB to a fresh temp file — this suite writes task rows and must
// never touch the live hivematrix.db.
const TMP = mkdtempSync(join(tmpdir(), "hm-shutdown-test-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests, Task } = await import("@/lib/db");
const {
  INTERRUPTION_PREFIX,
  beginShutdown,
  resetShutdownState,
  isShuttingDown,
  getShutdownReason,
  checkpointInFlightTasks,
  describeInterruption,
  isInterruptionError,
  isKilledExit,
} = await import("./shutdown-checkpoint");
const { recoverOrphanedTasks } = await import("./recovery");

_resetDbForTests();
getDb();

// Throwaway children spawned by this suite only. Never signal anything else.
const spawned: ChildProcess[] = [];

function spawnThrowaway(): ChildProcess {
  const child = spawn("sleep", ["120"], { stdio: "ignore" });
  spawned.push(child);
  return child;
}

async function killThrowaway(child: ChildProcess, signal: NodeJS.Signals): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill(signal);
  });
}

test.after(async () => {
  for (const child of spawned) {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

const cleanup = () => {
  resetShutdownState();
  try {
    getDb().prepare("DELETE FROM tasks").run();
  } catch (err) {
    console.error("Cleanup error:", err);
  }
};

test.beforeEach(() => cleanup());

async function seedRunningTask(overrides: Record<string, unknown> = {}) {
  return Task.create({
    title: "[directive] [self-improvement] Maintenance & scan",
    description: "long-horizon self-improvement run",
    project: "hivematrix",
    projectPath: "/tmp/hivematrix",
    status: "in_progress",
    executor: "agent",
    sessionId: "sess-abc-123",
    agentPid: 999999, // deliberately dead
    startedAt: new Date().toISOString(),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// kill classification
// ---------------------------------------------------------------------------

test("isKilledExit separates a kill from a genuine agent failure", () => {
  // The three shapes actually observed in the failure data.
  assert.equal(isKilledExit(null, "SIGKILL"), true, "SIGKILL is a kill");
  assert.equal(isKilledExit(null, "SIGTERM"), true, "SIGTERM is a kill");
  assert.equal(isKilledExit(143, null), true, "143 = 128+SIGTERM is a kill");
  assert.equal(isKilledExit(137, null), true, "137 = 128+SIGKILL is a kill");

  // The agent deciding to exit non-zero is NOT a kill.
  assert.equal(isKilledExit(1, null), false, "exit 1 is a genuine agent failure");
  assert.equal(isKilledExit(0, null), false, "exit 0 is success");
  assert.equal(isKilledExit(2, null), false, "exit 2 is a genuine agent failure");
});

test("interruption error text never reads as an agent failure", () => {
  const text = describeInterruption("app_update");
  assert.ok(text.startsWith(INTERRUPTION_PREFIX), "must carry the Interrupted: marker");
  assert.match(text, /app update/i, "must name the real cause");
  assert.match(text, /agent did not fail/i, "must say plainly the agent did not fail");

  assert.equal(isInterruptionError(text), true);
  assert.equal(isInterruptionError("Killed by signal: SIGKILL"), false);
  assert.equal(isInterruptionError("Exited with code: 1"), false);
  assert.equal(isInterruptionError(null), false);
});

test("each shutdown cause produces its own distinguishable text", () => {
  const update = describeInterruption("app_update");
  const restart = describeInterruption("daemon_restart");
  const quit = describeInterruption("daemon_shutdown");
  const crash = describeInterruption("unclean_exit");
  const all = [update, restart, quit, crash];
  assert.equal(new Set(all).size, 4, "an operator must be able to tell the four causes apart");
  assert.match(crash, /crash|out-of-memory/i, "a hard crash must not be dressed up as a clean stop");
});

test("beginShutdown records the cause so an exit can be attributed to us", () => {
  assert.equal(isShuttingDown(), false);
  assert.equal(getShutdownReason(), null);
  beginShutdown("app_update");
  assert.equal(isShuttingDown(), true);
  assert.equal(getShutdownReason(), "app_update");
  resetShutdownState();
  assert.equal(isShuttingDown(), false);
});

// ---------------------------------------------------------------------------
// checkpoint
// ---------------------------------------------------------------------------

test("checkpoint promotes sessionId to resumeSessionId so the run can be resumed", async () => {
  const task = await seedRunningTask();

  const result = checkpointInFlightTasks("app_update");
  assert.equal(result.checkpointed, 1);
  assert.deepEqual(result.taskIds, [task._id]);

  const after = await Task.findById(task._id);
  assert.equal(after?.resumeSessionId, "sess-abc-123", "session must survive for --resume");
  assert.ok(isInterruptionError(after?.error), `error should be an interruption, got: ${after?.error}`);
});

test("checkpoint does not clobber an existing resumeSessionId", async () => {
  const task = await seedRunningTask({ resumeSessionId: "sess-original", sessionId: "sess-newer" });

  checkpointInFlightTasks("daemon_restart");

  const after = await Task.findById(task._id);
  assert.equal(after?.resumeSessionId, "sess-original", "an interrupted resume must keep its original anchor");
});

test("checkpoint ignores tasks that are not in flight", async () => {
  await seedRunningTask({ status: "backlog" });
  await seedRunningTask({ status: "done" });
  await seedRunningTask({ status: "review" });

  const result = checkpointInFlightTasks("daemon_shutdown");
  assert.equal(result.checkpointed, 0, "only assigned/in_progress work is in flight");
});

test("checkpoint covers assigned tasks, not just in_progress", async () => {
  await seedRunningTask({ status: "assigned" });
  const result = checkpointInFlightTasks("daemon_shutdown");
  assert.equal(result.checkpointed, 1, "a task killed between assign and spawn must also be recorded");
});

// ---------------------------------------------------------------------------
// kill -> recover -> resume
// ---------------------------------------------------------------------------

test("kill-then-resume: a checkpointed task is requeued with its session intact", async () => {
  // A real throwaway worker, so agentPid points at a process that genuinely
  // dies. Never signals anything this suite did not spawn.
  const worker = spawnThrowaway();
  const task = await seedRunningTask({ agentPid: worker.pid });

  // 1. Teardown checkpoints BEFORE the worker is signalled.
  beginShutdown("app_update");
  checkpointInFlightTasks("app_update");

  // 2. The worker is killed (this is what launchctl kickstart -k does to the
  //    whole process group).
  await killThrowaway(worker, "SIGKILL");

  // 3. Next boot recovers.
  const outcome = await recoverOrphanedTasks();
  assert.equal(outcome.resumed, 1, "the task should be resumable");
  assert.equal(outcome.restarted, 0);

  const after = await Task.findById(task._id);
  assert.equal(after?.status, "backlog", "an interrupted task must be requeued, not left failed");
  assert.equal(after?.resumeSessionId, "sess-abc-123", "resume anchor must survive the kill");
  assert.equal(after?.agentPid, null, "the dead pid must be cleared");
  assert.ok(isInterruptionError(after?.error), `should stay labelled as interrupted, got: ${after?.error}`);
  assert.match(after!.error!, /app update/i, "the operator must still be told an update did this");
});

test("kill-then-resume: a task killed with NO checkpoint is labelled a hard crash, not a tidy stop", async () => {
  const worker = spawnThrowaway();
  // Simulate the pre-fix / OOM path: the daemon died without checkpointing, so
  // the row still carries the raw signal text and no resumeSessionId.
  const task = await seedRunningTask({ agentPid: worker.pid, error: "Killed by signal: SIGKILL" });

  await killThrowaway(worker, "SIGKILL");

  const outcome = await recoverOrphanedTasks();
  assert.equal(outcome.resumed, 1, "sessionId is still promotable even without a checkpoint");

  const after = await Task.findById(task._id);
  assert.equal(after?.status, "backlog");
  assert.equal(after?.resumeSessionId, "sess-abc-123");
  assert.ok(isInterruptionError(after?.error), "a bare 'Killed by signal' must never be the whole story");
  assert.match(after!.error!, /crash|out-of-memory|clean/i, "must say the daemon did not stop cleanly");
  assert.doesNotMatch(after!.error!, /^Killed by signal/, "raw signal text must not survive as the error");
});

test("recovery leaves a task alone while its worker is still alive", async () => {
  // A worker that outlived the daemon still owns its task; requeueing it would
  // double-run the work.
  const worker = spawnThrowaway();
  const task = await seedRunningTask({ agentPid: worker.pid });

  const outcome = await recoverOrphanedTasks();
  assert.equal(outcome.stillRunning, 1, "a live worker keeps its task");
  assert.equal(outcome.resumed + outcome.restarted, 0);

  const after = await Task.findById(task._id);
  assert.equal(after?.status, "in_progress", "must not be requeued out from under a live worker");
  assert.equal(after?.agentPid, worker.pid);

  await killThrowaway(worker, "SIGKILL");
});

test("recovery reports a task with no session as a restart, not a resume", async () => {
  const task = await seedRunningTask({ sessionId: null, agentPid: 999999 });

  const outcome = await recoverOrphanedTasks();
  assert.equal(outcome.resumed, 0);
  assert.equal(outcome.restarted, 1, "no session means it genuinely starts over — say so honestly");

  const after = await Task.findById(task._id);
  assert.equal(after?.status, "backlog");
  assert.equal(after?.resumeSessionId, null);
});

test("recovery no longer erases the reason a task stopped", async () => {
  // Regression guard for the original bug: recovery used to blank error to NULL,
  // so the operator saw a task silently back in the backlog with no explanation.
  const task = await seedRunningTask();
  checkpointInFlightTasks("daemon_shutdown");

  await recoverOrphanedTasks();

  const after = await Task.findById(task._id);
  assert.notEqual(after?.error, null, "the reason must not be blanked");
  assert.ok(isInterruptionError(after?.error));
});

test("a SIGTERM-drained worker is recorded as interrupted, not as exit code 143", async () => {
  // Exit 143 (128+SIGTERM) was 3 of the 14 recorded failures and read as a
  // normal agent failure. It must classify as a kill.
  const worker = spawnThrowaway();
  const task = await seedRunningTask({ agentPid: worker.pid });

  beginShutdown("daemon_shutdown");
  checkpointInFlightTasks("daemon_shutdown");
  await killThrowaway(worker, "SIGTERM");

  assert.equal(isKilledExit(143, null), true);

  await recoverOrphanedTasks();
  const after = await Task.findById(task._id);
  assert.equal(after?.status, "backlog");
  assert.doesNotMatch(after!.error!, /Exited with code: 143/, "143 must not surface as an agent failure");
  assert.match(after!.error!, /shut down/i);
});
