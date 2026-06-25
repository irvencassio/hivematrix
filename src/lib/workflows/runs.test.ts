import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-workflow-runs-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const {
  createWorkflowRun,
  getWorkflowRun,
  listWorkflowRuns,
  updateWorkflowRunStatus,
  appendWorkflowRunEvent,
  linkWorkflowRunArtifact,
  setWorkflowRunLinks,
  findWorkflowRunByDraft,
  reviewWorkflowRun,
  reviseWorkflowRunArtifact,
  isWorkflowRunApproved,
  isWorkflowRunReviewBlocked,
} = await import("./runs");

const HEYGEN = "heygen.portal_video_from_script";

before(() => { _resetDbForTests(); getDb(); });
after(() => { _resetDbForTests(); delete process.env.HIVEMATRIX_DB_PATH; rmSync(TMP, { recursive: true, force: true }); });
beforeEach(() => { getDb().exec("DELETE FROM workflow_runs; DELETE FROM workflow_run_events;"); });

test("createWorkflowRun validates the workflowId against the registry", () => {
  assert.throws(() => createWorkflowRun({ workflowId: "does.not.exist" }), /workflow|unknown|registry/i);
  const run = createWorkflowRun({ workflowId: HEYGEN, title: "Launch", draftId: "d1" });
  assert.equal(run.workflowId, HEYGEN);
  assert.equal(run.lane, "browser");            // defaulted from the registry def
  assert.equal(run.capability, "workflow.run");
  assert.equal(run.runbook, "docs/runbooks/heygen-portal-video-pipeline.md");
  assert.equal(run.status, "created");
});

test("get/list reflect created runs and a created event is recorded", () => {
  const run = createWorkflowRun({ workflowId: HEYGEN, title: "Launch", draftId: "d1" });
  const detail = getWorkflowRun(run.id);
  assert.ok(detail);
  assert.equal(detail.id, run.id);
  assert.ok(detail.events.some((e) => e.event === "created"));

  createWorkflowRun({ workflowId: HEYGEN, title: "Second", draftId: "d2" });
  assert.equal(listWorkflowRuns().length, 2);
  assert.equal(listWorkflowRuns({ draftId: "d1" }).length, 1);
  assert.equal(listWorkflowRuns({ workflowId: HEYGEN }).length, 2);
});

test("updateWorkflowRunStatus stamps completedAt for terminal states and appends an event", () => {
  const run = createWorkflowRun({ workflowId: HEYGEN, title: "Launch", draftId: "d1" });
  updateWorkflowRunStatus(run.id, "portal_pending", { currentStep: "portal task created" });
  let detail = getWorkflowRun(run.id);
  assert.equal(detail?.status, "portal_pending");
  assert.equal(detail?.completedAt, null);
  assert.equal(detail?.currentStep, "portal task created");

  updateWorkflowRunStatus(run.id, "done");
  detail = getWorkflowRun(run.id);
  assert.equal(detail?.status, "done");
  assert.ok(detail?.completedAt, "terminal state sets completedAt");
  assert.ok(detail?.events.some((e) => e.event === "status" && /done/.test(e.message)));
});

test("artifacts + links merge and events redact secret-looking metadata", () => {
  const run = createWorkflowRun({ workflowId: HEYGEN, title: "Launch", draftId: "d1" });
  linkWorkflowRunArtifact(run.id, "youtubeUrl", "https://youtu.be/abc");
  setWorkflowRunLinks(run.id, { childTaskId: "child-1", parentTaskId: "parent-1" });
  appendWorkflowRunEvent(run.id, "note", "portal session", { traceRunId: "t1", sessionCookie: "leak-me", password: "leak-me-too" });

  const detail = getWorkflowRun(run.id);
  assert.equal(detail?.artifacts.youtubeUrl, "https://youtu.be/abc");
  assert.equal(detail?.childTaskId, "child-1");
  assert.equal(detail?.parentTaskId, "parent-1");
  const ev = detail?.events.find((e) => e.event === "note");
  assert.equal(ev?.metadata.traceRunId, "t1");
  assert.equal(ev?.metadata.sessionCookie, "[redacted]");
  assert.equal(ev?.metadata.password, "[redacted]");
  // The whole record/events JSON leaks no secret values.
  assert.doesNotMatch(JSON.stringify(detail), /leak-me/);
});

test("findWorkflowRunByDraft returns the latest run for a draft", () => {
  createWorkflowRun({ workflowId: HEYGEN, title: "first", draftId: "d1" });
  const second = createWorkflowRun({ workflowId: HEYGEN, title: "second", draftId: "d1" });
  // Same draft, two runs → latest by rowid wins even at same-second createdAt.
  assert.equal(findWorkflowRunByDraft("d1")?.id, second.id);
  assert.equal(findWorkflowRunByDraft("nope"), null);
});

test("a needs_review run is review-blocked until approved", () => {
  const run = createWorkflowRun({ workflowId: HEYGEN, title: "r", status: "needs_review" });
  assert.equal(isWorkflowRunApproved(run), false);
  assert.equal(isWorkflowRunReviewBlocked(run), true);

  const approved = reviewWorkflowRun(run.id, "approve", { note: "looks good" })!;
  assert.equal(approved.status, "approved");
  assert.equal(approved.reviewDecision, "approve");
  assert.equal(approved.reviewNote, "looks good");
  assert.ok(approved.reviewedAt);
  assert.equal(isWorkflowRunApproved(approved), true);
  assert.equal(isWorkflowRunReviewBlocked(approved), false);

  const detail = getWorkflowRun(run.id);
  assert.ok(detail?.events.some((e) => e.event === "review.approve"));
});

test("request_changes and reject keep the run blocked, and the note is secret-scrubbed", () => {
  const a = createWorkflowRun({ workflowId: HEYGEN, title: "a", status: "needs_review" });
  const changed = reviewWorkflowRun(a.id, "request_changes", { note: "tighten the hook; token=LEAK" })!;
  assert.equal(changed.status, "changes_requested");
  assert.equal(isWorkflowRunReviewBlocked(changed), true);
  assert.doesNotMatch(JSON.stringify(changed), /LEAK/);

  const b = createWorkflowRun({ workflowId: HEYGEN, title: "b", status: "needs_review" });
  const rejected = reviewWorkflowRun(b.id, "reject", {})!;
  assert.equal(rejected.status, "rejected");
  assert.equal(isWorkflowRunReviewBlocked(rejected), true);
});

test("reviseWorkflowRunArtifact scrubs, keeps the original, logs an event, and touches only that key", () => {
  const run = createWorkflowRun({ workflowId: HEYGEN, title: "r", status: "needs_review" });
  linkWorkflowRunArtifact(run.id, "scriptText", "original narration");
  linkWorkflowRunArtifact(run.id, "title", "Original title");

  reviseWorkflowRunArtifact(run.id, "scriptText", "revised narration with token=LEAK inline");
  const detail = getWorkflowRun(run.id);
  assert.match(String(detail?.artifacts.scriptText), /revised narration/);
  assert.doesNotMatch(String(detail?.artifacts.scriptText), /LEAK/);          // scrubbed value
  assert.equal(detail?.artifacts.scriptText_original, "original narration");  // original kept
  assert.equal(detail?.artifacts.title, "Original title");                    // unrelated artifact untouched
  assert.ok(detail?.events.some((e) => e.event === "artifact.revised"));
});
