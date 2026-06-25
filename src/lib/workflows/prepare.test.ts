import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-workflow-prepare-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { prepareWorkflowById } = await import("./prepare");
const { getWorkflowRun } = await import("./runs");

before(() => { _resetDbForTests(); getDb(); });
after(() => { _resetDbForTests(); delete process.env.HIVEMATRIX_DB_PATH; rmSync(TMP, { recursive: true, force: true }); });
beforeEach(() => { getDb().exec("DELETE FROM workflow_runs; DELETE FROM workflow_run_events; DELETE FROM workflow_actions;"); });

test("unknown workflow → unsupported", async () => {
  const out = await prepareWorkflowById("nope.nope", {});
  assert.equal(out.ok, false);
  assert.equal(out.status, "unsupported");
});

test("missing required inputs → needs_input with the exact field names", async () => {
  const out = await prepareWorkflowById("content.research_brief", {}); // topic required
  assert.equal(out.ok, false);
  assert.equal(out.status, "needs_input");
  assert.ok(out.missing?.includes("topic"));
});

test("the content brief handler is dispatched and creates a run", async () => {
  const out = await prepareWorkflowById("content.research_brief", { topic: "AI video tools" });
  assert.equal(out.ok, true);
  assert.equal(out.status, "prepared");
  assert.ok(out.runId);
  assert.equal(getWorkflowRun(out.runId)?.workflowId, "content.research_brief");
});
