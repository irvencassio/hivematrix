import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function withTempDb<T>(run: () => T | Promise<T>): Promise<T> {
  const originalHome = process.env.HOME;
  const originalDbPath = process.env.HIVEMATRIX_DB_PATH;
  const tmp = mkdtempSync(join(tmpdir(), "hm-batch-verification-db-test-"));
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = join(tmp, "test.db");
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  try {
    return await run();
  } finally {
    _resetDbForTests();
    if (originalDbPath) process.env.HIVEMATRIX_DB_PATH = originalDbPath; else delete process.env.HIVEMATRIX_DB_PATH;
    if (originalHome) process.env.HOME = originalHome;
    rmSync(tmp, { recursive: true, force: true });
  }
}

test("Task.create → Task.findById round-trips batchId and verification intact", async () => {
  await withTempDb(async () => {
    const { Task, generateId } = await import("@/lib/db");

    const id = generateId();
    const created = await Task.create({
      _id: id,
      title: "t",
      description: "d",
      project: "p",
      projectPath: "/tmp/p",
      status: "backlog",
      executor: "agent",
      batchId: "batch-abc123",
      verification: { verdict: "passed", report: "all good", ranAt: "2026-07-15T00:00:00.000Z" },
    });

    assert.equal(created.batchId, "batch-abc123");
    assert.deepEqual(created.verification, {
      verdict: "passed",
      report: "all good",
      ranAt: "2026-07-15T00:00:00.000Z",
    });

    const fetched = await Task.findById(id);
    assert.ok(fetched);
    assert.equal(fetched!.batchId, "batch-abc123");
    assert.deepEqual(fetched!.verification, {
      verdict: "passed",
      report: "all good",
      ranAt: "2026-07-15T00:00:00.000Z",
    });
  });
});

test("Task.create defaults batchId and verification to null when omitted", async () => {
  await withTempDb(async () => {
    const { Task, generateId } = await import("@/lib/db");

    const id = generateId();
    const created = await Task.create({
      _id: id,
      title: "t",
      description: "d",
      project: "p",
      projectPath: "/tmp/p",
      status: "backlog",
      executor: "agent",
    });

    assert.equal(created.batchId, null);
    assert.equal(created.verification, null);

    const fetched = await Task.findById(id);
    assert.equal(fetched!.batchId, null);
    assert.equal(fetched!.verification, null);
  });
});

test("Task.findByIdAndUpdate serializes a verification object and it round-trips as an object", async () => {
  await withTempDb(async () => {
    const { Task, generateId } = await import("@/lib/db");

    const id = generateId();
    await Task.create({
      _id: id,
      title: "t",
      description: "d",
      project: "p",
      projectPath: "/tmp/p",
      status: "backlog",
      executor: "agent",
    });

    const updated = await Task.findByIdAndUpdate(id, {
      verification: { verdict: "failed", report: "crashed", ranAt: "2026-07-15T01:00:00.000Z" },
    });
    assert.deepEqual(updated!.verification, {
      verdict: "failed",
      report: "crashed",
      ranAt: "2026-07-15T01:00:00.000Z",
    });

    const fetched = await Task.findById(id);
    assert.deepEqual(fetched!.verification, {
      verdict: "failed",
      report: "crashed",
      ranAt: "2026-07-15T01:00:00.000Z",
    });
  });
});

test("verification column survives malformed JSON without throwing — parses back to null", async () => {
  await withTempDb(async () => {
    const { Task, generateId, getDb } = await import("@/lib/db");

    const id = generateId();
    await Task.create({
      _id: id,
      title: "t",
      description: "d",
      project: "p",
      projectPath: "/tmp/p",
      status: "backlog",
      executor: "agent",
    });
    // Simulate a corrupted column value bypassing the normal write path.
    getDb().prepare("UPDATE tasks SET verification = ? WHERE _id = ?").run("{not json", id);

    const fetched = await Task.findById(id);
    assert.equal(fetched!.verification, null);
  });
});
