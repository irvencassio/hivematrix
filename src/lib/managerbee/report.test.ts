import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Isolate the DB and the approvals dir (HOME) before importing anything.
const TMP = mkdtempSync(join(tmpdir(), "hm-managerbee-test-"));
process.env.HOME = TMP;
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { createDirective, createRun, setRunPhase } = await import("@/lib/orchestrator/directive-store");
const { requestCheckpointApproval } = await import("@/lib/orchestrator/approval");
const { buildManagerBeeReport } = await import("./report");

_resetDbForTests();
getDb();

test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

function mkDir(status: "active" | "sleeping" | "blocked" | "done" | "retired", goal: string) {
  return createDirective({
    goal,
    profile: "default",
    project: "p",
    projectPath: "/tmp",
    status,
  });
}

test("buildManagerBeeReport aggregates directives, in-flight runs, and escalations", () => {
  const a = mkDir("active", "A");
  const b = mkDir("active", "B");
  mkDir("sleeping", "C");

  createRun(a._id); // phase plan
  const r2 = createRun(b._id);
  setRunPhase(r2._id, "execute");

  const report = buildManagerBeeReport("2026-06-12T00:00:00Z");

  assert.equal(report.generatedAt, "2026-06-12T00:00:00Z");
  assert.equal(report.directives.total, 3);
  assert.equal(report.directives.byStatus.active, 2);
  assert.equal(report.directives.byStatus.sleeping, 1);
  assert.equal(report.runs.inFlight, 2);
  assert.equal(report.runs.byPhase.plan, 1);
  assert.equal(report.runs.byPhase.execute, 1);
  assert.equal(report.escalations.pendingApprovals, 0);
  assert.equal(report.escalations.pendingStuck, 0);
  assert.equal(report.health, "ok");
});

test("a pending approval flips ManagerBee health to attention", () => {
  requestCheckpointApproval({ id: "run_mgr_1", gate: "plan", goal: "Ship", summary: "1 task" });
  const report = buildManagerBeeReport("2026-06-12T01:00:00Z");
  assert.ok(report.escalations.pendingApprovals >= 1);
  assert.equal(report.health, "attention");
});
