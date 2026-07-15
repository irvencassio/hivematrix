import test from "node:test";
import assert from "node:assert/strict";
import { getDb } from "@/lib/db";
import { attemptReserveRun, isRunClaimed, markRunCreated, getCreatedRunId } from "./directive-dispatch-cap";

const cleanup = () => {
  try {
    getDb().prepare("DELETE FROM directive_dispatch_cap").run();
  } catch (err) {
    console.error("Cleanup error:", err);
  }
};

test.beforeEach(() => {
  cleanup();
});

test("attemptReserveRun reserves a slot atomically and returns true on first call", () => {
  const directiveId = "test-directive-123";
  const runStartedAt = new Date().toISOString();

  const reserved = attemptReserveRun(directiveId, runStartedAt);
  assert.equal(reserved, true, "first reserve attempt should succeed");

  // Verify the slot is now claimed
  assert.equal(isRunClaimed(directiveId, runStartedAt), true, "slot should be claimed after successful reserve");
});

test("attemptReserveRun returns false when the same slot is claimed concurrently", () => {
  const directiveId = "test-directive-concurrent";
  const runStartedAt = new Date().toISOString();

  // First process claims the slot
  const first = attemptReserveRun(directiveId, runStartedAt);
  assert.equal(first, true, "first process should claim the slot");

  // Second process tries to claim the same slot (concurrent/restart race)
  const second = attemptReserveRun(directiveId, runStartedAt);
  assert.equal(second, false, "second process should fail due to UNIQUE constraint");
});

test("attemptReserveRun allows different directives to reserve slots", () => {
  const runStartedAt = new Date().toISOString();

  const first = attemptReserveRun("directive-1", runStartedAt);
  const second = attemptReserveRun("directive-2", runStartedAt);

  assert.equal(first, true, "directive-1 should reserve");
  assert.equal(second, true, "directive-2 should reserve at the same time");
});

test("attemptReserveRun allows the same directive to reserve at different times", () => {
  const directiveId = "test-directive-time-series";
  const time1 = new Date("2026-07-14T07:00:00Z").toISOString();
  const time2 = new Date("2026-07-14T08:00:00Z").toISOString();

  const first = attemptReserveRun(directiveId, time1);
  const second = attemptReserveRun(directiveId, time2);

  assert.equal(first, true, "directive at time1 should reserve");
  assert.equal(second, true, "same directive at time2 should also reserve");
});

test("markRunCreated stores the created runId and getCreatedRunId retrieves it", () => {
  const directiveId = "test-directive-runid";
  const runStartedAt = new Date().toISOString();
  const createdRunId = "run-abc-123";

  // Reserve the slot first
  attemptReserveRun(directiveId, runStartedAt);

  // Mark it as created
  markRunCreated(directiveId, runStartedAt, createdRunId);

  // Verify we can retrieve it
  const retrieved = getCreatedRunId(directiveId, runStartedAt);
  assert.equal(retrieved, createdRunId, "should retrieve the created runId");
});

test("getCreatedRunId returns null for unclaimed slots", () => {
  const directiveId = "test-directive-unclaimed";
  const runStartedAt = new Date("2026-07-14T09:00:00Z").toISOString();

  const retrieved = getCreatedRunId(directiveId, runStartedAt);
  assert.equal(retrieved, null, "should return null for unclaimed slot");
});

test("getCreatedRunId returns null for claimed but un-marked slots", () => {
  const directiveId = "test-directive-claimed-unmarked";
  const runStartedAt = new Date().toISOString();

  // Reserve but don't mark as created
  attemptReserveRun(directiveId, runStartedAt);

  const retrieved = getCreatedRunId(directiveId, runStartedAt);
  assert.equal(retrieved, null, "should return null when not yet marked as created");
});

test("concurrent reserve attempts race correctly — exactly one wins", async () => {
  const directiveId = "test-directive-concurrent-race";
  const runStartedAt = new Date().toISOString();

  // Simulate two concurrent processes racing to reserve the same slot
  const results = await Promise.all([
    Promise.resolve(attemptReserveRun(directiveId, runStartedAt)),
    Promise.resolve(attemptReserveRun(directiveId, runStartedAt)),
  ]);

  const successCount = results.filter((r) => r === true).length;
  const failureCount = results.filter((r) => r === false).length;

  assert.equal(successCount, 1, "exactly one process should succeed");
  assert.equal(failureCount, 1, "exactly one process should fail");
  assert.equal(isRunClaimed(directiveId, runStartedAt), true, "slot should be claimed");
});

test("concurrent reserve + mark pattern: first process wins and marks, second sees the mark", async () => {
  // This is the real-world scenario from the 2026-07-14 incident:
  // Two daemon processes (or a restart race) both try to reserve and create a run
  // for the same directive. Only one succeeds, and the other can reconcile by
  // reading the created runId.
  const directiveId = "test-directive-daemon-restart-2026-07-14";
  const runStartedAt = new Date().toISOString();
  const runId1 = "run-created-by-process-1";
  const runId2 = "run-would-be-created-by-process-2";

  // Simulate two concurrent processes
  const process1Result = await Promise.resolve().then(() => {
    const reserved = attemptReserveRun(directiveId, runStartedAt);
    if (reserved) {
      markRunCreated(directiveId, runStartedAt, runId1);
    }
    return { reserved, runId: reserved ? runId1 : null };
  });

  const process2Result = await Promise.resolve().then(() => {
    const reserved = attemptReserveRun(directiveId, runStartedAt);
    if (!reserved) {
      // Failed to reserve; check if a run was already created
      const existingRunId = getCreatedRunId(directiveId, runStartedAt);
      return { reserved, runId: existingRunId };
    }
    markRunCreated(directiveId, runStartedAt, runId2);
    return { reserved, runId: runId2 };
  });

  // Process 1 should have reserved and created
  assert.equal(process1Result.reserved, true, "process 1 should reserve");
  assert.equal(process1Result.runId, runId1, "process 1 should have its own runId");

  // Process 2 should have failed to reserve but found the runId from process 1
  assert.equal(process2Result.reserved, false, "process 2 should fail to reserve");
  assert.equal(process2Result.runId, runId1, "process 2 should reconcile to process 1's runId");

  // Verify only one runId is stored
  const finalRunId = getCreatedRunId(directiveId, runStartedAt);
  assert.equal(finalRunId, runId1, "final stored runId should be from process 1");
});
