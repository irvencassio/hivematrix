import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-heygen-runlink-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { getWorkflowRun, findWorkflowRunByDraft } = await import("./runs");
const {
  linkHeyGenPortalRunOnDispatch,
  linkHeyGenPortalRunOnCompletion,
  linkHeyGenPortalRunOnPublish,
} = await import("./heygen-run-link");

before(() => { _resetDbForTests(); getDb(); });
after(() => { _resetDbForTests(); delete process.env.HIVEMATRIX_DB_PATH; rmSync(TMP, { recursive: true, force: true }); });
beforeEach(() => { getDb().exec("DELETE FROM workflow_runs; DELETE FROM workflow_run_events;"); });

const dispatchResult = (status: string, extra: Record<string, unknown> = {}) => ({
  status, request: { text: "x" }, route: null, lane: "browser", capability: "workflow.run",
  workItem: null, approval: null, readiness: { status: "ready", color: "green" }, workflow: null,
  reason: `dispatch ${status}`, auditId: "audit-1", taskId: null, job: {},
  ...extra,
}) as never;

test("a created dispatch opens a portal_pending run linked to the draft + child task", () => {
  const run = linkHeyGenPortalRunOnDispatch(dispatchResult("created", { taskId: "child-1" }), { draftId: "d1", title: "Launch" });
  assert.equal(run.status, "portal_pending");
  assert.equal(run.draftId, "d1");
  assert.equal(run.childTaskId, "child-1");
  assert.equal(run.artifacts.dispatchAuditId, "audit-1");
});

test("a readiness_required dispatch opens a blocked run with the reason", () => {
  const run = linkHeyGenPortalRunOnDispatch(dispatchResult("readiness_required", { reason: "site needs reauth" }), { draftId: "d2", title: "Launch" });
  assert.equal(run.status, "blocked");
  assert.match(run.blocker ?? "", /reauth/i);
});

test("re-dispatch for the same draft updates the existing run (no duplicate)", () => {
  linkHeyGenPortalRunOnDispatch(dispatchResult("readiness_required"), { draftId: "d3", title: "Launch" });
  linkHeyGenPortalRunOnDispatch(dispatchResult("created", { taskId: "child-9" }), { draftId: "d3", title: "Launch" });
  const runs = getDb().prepare("SELECT COUNT(*) AS n FROM workflow_runs WHERE draftId = 'd3'").get() as { n: number };
  assert.equal(runs.n, 1);
  assert.equal(findWorkflowRunByDraft("d3")?.status, "portal_pending");
});

test("completion updates the run to portal_completed / needs_publish_input / failed", () => {
  linkHeyGenPortalRunOnDispatch(dispatchResult("created", { taskId: "c1" }), { draftId: "dc", title: "Launch" });
  linkHeyGenPortalRunOnCompletion("dc", { status: "portal_completed" });
  assert.equal(findWorkflowRunByDraft("dc")?.status, "portal_completed");

  linkHeyGenPortalRunOnCompletion("dc", { status: "needs_publish_input" });
  assert.equal(findWorkflowRunByDraft("dc")?.status, "needs_publish_input");

  linkHeyGenPortalRunOnCompletion("dc", { status: "review", childStatus: "failed" });
  assert.equal(findWorkflowRunByDraft("dc")?.status, "failed");
});

test("a successful publish marks the run done with the YouTube artifact", () => {
  const run = linkHeyGenPortalRunOnDispatch(dispatchResult("created", { taskId: "c2" }), { draftId: "dp", title: "Launch" });
  linkHeyGenPortalRunOnCompletion("dp", { status: "portal_completed" });
  linkHeyGenPortalRunOnPublish("dp", { ok: true, published: true, draftId: "dp", youtubeUrl: "https://youtu.be/done" } as never);
  const detail = getWorkflowRun(run.id);
  assert.equal(detail?.status, "done");
  assert.ok(detail?.completedAt);
  assert.equal(detail?.artifacts.youtubeUrl, "https://youtu.be/done");
});

test("linkage carries no secret material", () => {
  const run = linkHeyGenPortalRunOnDispatch(dispatchResult("created", { taskId: "c3" }), { draftId: "ds", title: "Launch" });
  assert.doesNotMatch(JSON.stringify(getWorkflowRun(run.id)), /password|cookie|secret|credentialRef|\btoken\b/i);
});
