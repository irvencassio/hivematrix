import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-telemetry-test-"));
process.env.HOME = TMP;
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const {
  isTelemetryEnabled,
  setTelemetryEnabled,
  setTelemetryContext,
  recordTelemetryEvent,
  getTelemetrySummary,
  clearTelemetry,
} = await import("./telemetry");

_resetDbForTests();
getDb();

test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

test.beforeEach(() => {
  setTelemetryEnabled(false);
  clearTelemetry();
});

test("telemetry is off by default — recording is a no-op", () => {
  assert.equal(isTelemetryEnabled(), false);
  assert.equal(recordTelemetryEvent({ category: "task", event: "completed" }), false);
  const summary = getTelemetrySummary();
  assert.equal(summary.enabled, false);
  assert.equal(summary.total, 0);
});

test("enabling telemetry records events, tagged with context, and summarizes them", () => {
  setTelemetryEnabled(true);
  setTelemetryContext({ connectivity: "local-only", version: "0.1.1" });

  assert.equal(recordTelemetryEvent({ category: "task", event: "completed" }), true);
  recordTelemetryEvent({ category: "task", event: "completed" });
  recordTelemetryEvent({ category: "directive", event: "yielded", payload: { phase: "reflect" } });

  const summary = getTelemetrySummary();
  assert.equal(summary.enabled, true);
  assert.equal(summary.total, 3);
  assert.equal(summary.byCategory.task, 2);
  assert.equal(summary.byCategory.directive, 1);
  assert.equal(summary.byEvent["task.completed"], 2);
  assert.ok(summary.since);

  // Context tags are persisted on the row.
  const row = getDb().prepare("SELECT connectivity, version FROM telemetry_events LIMIT 1").get() as { connectivity: string; version: string };
  assert.equal(row.connectivity, "local-only");
  assert.equal(row.version, "0.1.1");
});

test("clearTelemetry purges every event (privacy)", () => {
  setTelemetryEnabled(true);
  recordTelemetryEvent({ category: "task", event: "completed" });
  assert.equal(getTelemetrySummary().total, 1);
  const cleared = clearTelemetry();
  assert.equal(cleared, 1);
  assert.equal(getTelemetrySummary().total, 0);
});
