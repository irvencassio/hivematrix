import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-workflow-actions-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { createWorkflowRun, reviewWorkflowRun, reviseWorkflowRunArtifact, linkWorkflowRunArtifact } = await import("./runs");
const {
  proposeWorkflowAction,
  listWorkflowActions,
  getWorkflowAction,
  executeWorkflowAction,
  updateWorkflowActionStatus,
} = await import("./actions");

const HEYGEN = "heygen.portal_video_from_script";
const BRIEF = "content.research_brief";

before(() => { _resetDbForTests(); getDb(); });
after(() => { _resetDbForTests(); delete process.env.HIVEMATRIX_DB_PATH; rmSync(TMP, { recursive: true, force: true }); });
beforeEach(() => { getDb().exec("DELETE FROM workflow_runs; DELETE FROM workflow_run_events; DELETE FROM workflow_actions;"); });

function sourceRun() {
  return createWorkflowRun({ workflowId: BRIEF, title: "brief" });
}

test("proposeWorkflowAction validates the target workflow and redacts suggested inputs", () => {
  const run = sourceRun();
  assert.throws(() => proposeWorkflowAction({ sourceRunId: run.id, targetWorkflowId: "does.not.exist", title: "x" }), /workflow|unknown|registry/i);

  const action = proposeWorkflowAction({
    sourceRunId: run.id, targetWorkflowId: HEYGEN, title: "Video: AI tools", reason: "turn the brief into a video",
    suggestedInputs: { title: "Video: AI tools", scriptDraft: "draft from brief", sessionCookie: "leak-me" },
  });
  assert.equal(action.status, "proposed");
  assert.equal(action.targetWorkflowId, HEYGEN);
  // Required inputs default to the target def's required fields.
  assert.ok(action.requiredInputs.includes("script"));
  assert.ok(action.requiredInputs.includes("title"));
  // Suggested inputs are redacted.
  assert.equal(action.suggestedInputs.sessionCookie, "[redacted]");
  assert.doesNotMatch(JSON.stringify(action), /leak-me/);
});

test("list/get reflect proposed actions for a run", () => {
  const run = sourceRun();
  const a = proposeWorkflowAction({ sourceRunId: run.id, targetWorkflowId: HEYGEN, title: "v" });
  assert.equal(listWorkflowActions({ sourceRunId: run.id }).length, 1);
  assert.equal(getWorkflowAction(a.id)?.id, a.id);
});

test("executing an action with missing required inputs returns needs_input (no execution)", async () => {
  const run = sourceRun();
  const a = proposeWorkflowAction({
    sourceRunId: run.id, targetWorkflowId: HEYGEN, title: "Video: AI tools",
    suggestedInputs: { title: "Video: AI tools", scriptDraft: "draft only — not a real script" },
  });
  let prepareCalls = 0;
  const result = await executeWorkflowAction(a.id, {}, { prepare: async () => { prepareCalls += 1; return { ok: true, status: "prepared", workflow: null }; } });
  assert.equal(result.ok, false);
  assert.equal(result.status, "needs_input");
  assert.ok(result.missing?.includes("script"), "script is the exact missing field");
  assert.ok(!result.missing?.includes("title"), "title was suggested, so it is satisfied");
  assert.equal(prepareCalls, 0, "must not execute the target when inputs are insufficient");
  assert.equal(getWorkflowAction(a.id)?.status, "proposed"); // unchanged
});

test("executing with sufficient inputs calls the registered handler path and completes", async () => {
  const run = sourceRun();
  const a = proposeWorkflowAction({ sourceRunId: run.id, targetWorkflowId: HEYGEN, title: "Video: AI tools", suggestedInputs: { title: "Video: AI tools" } });
  const seen: Array<{ id: string; inputs: Record<string, unknown> }> = [];
  const result = await executeWorkflowAction(a.id, { script: "Hello. This is the real script." }, {
    prepare: async (workflowId, inputs) => { seen.push({ id: workflowId, inputs }); return { ok: true, status: "prepared", workflow: null, runId: "target-run-1" }; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "prepared");
  // The generic handler path was used — by workflow id, not bespoke HeyGen code.
  assert.equal(seen[0].id, HEYGEN);
  assert.equal(seen[0].inputs.script, "Hello. This is the real script.");
  assert.equal(seen[0].inputs.title, "Video: AI tools");
  const after = getWorkflowAction(a.id);
  assert.equal(after?.status, "completed");
  assert.equal(after?.resultRunId, "target-run-1");
});

test("execution is blocked with review_required when the source run is needs_review and unapproved", async () => {
  const run = createWorkflowRun({ workflowId: BRIEF, title: "script", status: "needs_review" });
  const a = proposeWorkflowAction({ sourceRunId: run.id, targetWorkflowId: HEYGEN, title: "v", suggestedInputs: { title: "v", script: "real script" } });
  let prepareCalls = 0;
  const result = await executeWorkflowAction(a.id, {}, { prepare: async () => { prepareCalls += 1; return { ok: true, status: "prepared", workflow: null, runId: "x" }; } });
  assert.equal(result.ok, false);
  assert.equal(result.status, "review_required");
  assert.equal(result.sourceRunId, run.id);
  assert.equal(prepareCalls, 0, "must not dispatch the target while the source run is unapproved");
  assert.equal(getWorkflowAction(a.id)?.status, "proposed");
});

test("approving the source run unlocks execution; rejecting keeps it blocked", async () => {
  const run = createWorkflowRun({ workflowId: BRIEF, title: "script", status: "needs_review" });
  const a = proposeWorkflowAction({ sourceRunId: run.id, targetWorkflowId: HEYGEN, title: "v", suggestedInputs: { title: "v", script: "real script" } });

  // Reject → still blocked.
  reviewWorkflowRun(run.id, "reject", {});
  const blocked = await executeWorkflowAction(a.id, {}, { prepare: async () => ({ ok: true, status: "prepared", workflow: null }) });
  assert.equal(blocked.status, "review_required");

  // Approve → unlocked.
  reviewWorkflowRun(run.id, "approve", {});
  const ok = await executeWorkflowAction(a.id, {}, { prepare: async () => ({ ok: true, status: "prepared", workflow: null, runId: "done-1" }) });
  assert.equal(ok.ok, true);
  assert.equal(ok.status, "prepared");
});

test("sourceArtifactMap pulls the CURRENT (revised) source artifact over the stale suggested input", async () => {
  const run = createWorkflowRun({ workflowId: BRIEF, title: "script", status: "needs_review" });
  linkWorkflowRunArtifact(run.id, "scriptText", "ORIGINAL script");
  const a = proposeWorkflowAction({
    sourceRunId: run.id, targetWorkflowId: HEYGEN, title: "Video", suggestedInputs: { title: "Video", script: "ORIGINAL script" },
    sourceArtifactMap: { script: "scriptText", title: "title" },
  });
  // Operator revises the script, then approves.
  reviseWorkflowRunArtifact(run.id, "scriptText", "REVISED script");
  reviewWorkflowRun(run.id, "approve", {});

  let seen: Record<string, unknown> = {};
  const result = await executeWorkflowAction(a.id, {}, { prepare: async (_wid, inputs) => { seen = inputs; return { ok: true, status: "prepared", workflow: null, runId: "r" }; } });
  assert.equal(result.ok, true);
  assert.equal(seen.script, "REVISED script", "execution used the revised script, not the stale suggestion");
});

test("assessWorkflowAction agrees with the gate without executing", async () => {
  const { assessWorkflowAction } = await import("./actions");
  // review-blocked source run
  const blocked = createWorkflowRun({ workflowId: BRIEF, title: "s", status: "needs_review" });
  const ab = proposeWorkflowAction({ sourceRunId: blocked.id, targetWorkflowId: HEYGEN, title: "v", suggestedInputs: { title: "v", script: "real" } });
  assert.equal(assessWorkflowAction(getWorkflowAction(ab.id)!).readiness, "review_required");

  // approved + has inputs → ready
  reviewWorkflowRun(blocked.id, "approve", {});
  assert.equal(assessWorkflowAction(getWorkflowAction(ab.id)!).readiness, "ready");

  // missing required input → needs_input with exact fields
  const open = createWorkflowRun({ workflowId: HEYGEN, title: "x", status: "done" });
  const an = proposeWorkflowAction({ sourceRunId: open.id, targetWorkflowId: HEYGEN, title: "v", suggestedInputs: { title: "v" } });
  const assessment = assessWorkflowAction(getWorkflowAction(an.id)!);
  assert.equal(assessment.readiness, "needs_input");
  assert.ok(assessment.missing?.includes("script"));

  // completed action
  const ac = proposeWorkflowAction({ sourceRunId: open.id, targetWorkflowId: HEYGEN, title: "v", suggestedInputs: { title: "v", script: "s" } });
  updateWorkflowActionStatus(ac.id, "completed", { resultRunId: "r" });
  assert.equal(assessWorkflowAction(getWorkflowAction(ac.id)!).readiness, "completed");
});
