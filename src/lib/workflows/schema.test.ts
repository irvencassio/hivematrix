import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-workflow-schema-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");

before(() => { _resetDbForTests(); getDb(); });
after(() => { _resetDbForTests(); delete process.env.HIVEMATRIX_DB_PATH; rmSync(TMP, { recursive: true, force: true }); });

function columns(table: string): string[] {
  return (getDb().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name);
}

test("workflow_runs + workflow_run_events tables exist with the expected columns", () => {
  const runs = columns("workflow_runs");
  for (const c of ["workflowId", "status", "title", "lane", "capability", "parentTaskId", "draftId", "childTaskId", "currentStep", "blocker", "artifact_json", "runbook", "createdAt", "updatedAt", "completedAt"]) {
    assert.ok(runs.includes(c), `workflow_runs.${c} should exist`);
  }
  // Never a secret column.
  assert.equal(runs.includes("password"), false);

  const events = columns("workflow_run_events");
  for (const c of ["runId", "event", "message", "metadata_json", "createdAt"]) {
    assert.ok(events.includes(c), `workflow_run_events.${c} should exist`);
  }
});

test("workflow_actions table exists with the expected columns", () => {
  const cols = columns("workflow_actions");
  for (const c of ["sourceRunId", "targetWorkflowId", "title", "reason", "required_inputs_json", "suggested_inputs_json", "status", "resultRunId", "createdAt", "updatedAt"]) {
    assert.ok(cols.includes(c), `workflow_actions.${c} should exist`);
  }
  assert.equal(cols.includes("password"), false);
});
