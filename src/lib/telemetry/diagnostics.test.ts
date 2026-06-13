import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-diagnostics-test-"));
process.env.HOME = TMP;
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests, Task } = await import("@/lib/db");
const { setTelemetryEnabled, recordTelemetryEvent } = await import("./telemetry");
const { buildDiagnosticsBundle } = await import("./diagnostics");

_resetDbForTests();
getDb();

test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

test("buildDiagnosticsBundle assembles operational signal with no task content", async () => {
  // A failed task and a failed run journal entry to surface.
  const task = await Task.create({ title: "x", description: "secret details", project: "p", projectPath: "/tmp", status: "failed", error: "boom" });
  getDb()
    .prepare("INSERT INTO run_journal (runId, directiveId, step, payload) VALUES (?, ?, 'run_failed', ?)")
    .run("run_1", "dir_1", JSON.stringify({ reason: "model timeout" }));

  setTelemetryEnabled(true);
  recordTelemetryEvent({ category: "task", event: "failed" });

  const bundle = buildDiagnosticsBundle({ version: "0.1.1", connectivity: "cloud-ok" }, "2026-06-13T00:00:00Z");

  assert.equal(bundle.version, "0.1.1");
  assert.equal(bundle.connectivity, "cloud-ok");
  assert.equal(bundle.generatedAt, "2026-06-13T00:00:00Z");

  assert.ok(bundle.recentTaskFailures.some((f) => f.taskId === task._id && f.error === "boom"));
  // No task description / content leaks into the bundle.
  assert.ok(!JSON.stringify(bundle).includes("secret details"));

  assert.ok(bundle.recentRunFailures.some((r) => r.runId === "run_1" && r.reason === "model timeout"));
  assert.equal(bundle.telemetry.enabled, true);
  assert.ok(bundle.telemetry.total >= 1);
  assert.ok(bundle.scheduler, "scheduler diagnostics present");
  assert.ok(bundle.manager, "manager report present");
});
