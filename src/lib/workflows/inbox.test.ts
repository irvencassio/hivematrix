import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-workflow-inbox-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { createWorkflowRun, reviewWorkflowRun, linkWorkflowRunArtifact } = await import("./runs");
const { proposeWorkflowAction } = await import("./actions");
const { getWorkflowInbox, INBOX_GROUPS, formatWorkflowInboxSummary } = await import("./inbox");

const SRC = "content.research_brief";
const TARGET = "content.youtube_summary"; // generic target; required input: url

before(() => { _resetDbForTests(); getDb(); });
after(() => { _resetDbForTests(); delete process.env.HIVEMATRIX_DB_PATH; rmSync(TMP, { recursive: true, force: true }); });
beforeEach(() => { getDb().exec("DELETE FROM workflow_runs; DELETE FROM workflow_run_events; DELETE FROM workflow_actions;"); });

test("an empty inbox returns stable empty groups and zero counts", () => {
  const inbox = getWorkflowInbox();
  for (const g of INBOX_GROUPS) {
    assert.deepEqual(inbox.groups[g], []);
    assert.equal(inbox.counts[g], 0);
  }
});

test("a needs_review run appears in needs_review with a review nextAction", () => {
  const run = createWorkflowRun({ workflowId: SRC, title: "Research brief: AI tools", status: "needs_review" });
  const inbox = getWorkflowInbox();
  const item = inbox.groups.needs_review.find((i) => i.id === run.id);
  assert.ok(item);
  assert.equal(item.kind, "run");
  assert.match(item.nextAction, /review/i);
  assert.equal(inbox.counts.needs_review, 1);
});

test("an unapproved action is blocked with review_required; approving moves it to ready", () => {
  const run = createWorkflowRun({ workflowId: SRC, title: "brief", status: "needs_review" });
  linkWorkflowRunArtifact(run.id, "sourceText", "the brief");
  const a = proposeWorkflowAction({ sourceRunId: run.id, targetWorkflowId: TARGET, title: "Summary", suggestedInputs: { title: "Summary", url: "https://youtu.be/x" } });

  let inbox = getWorkflowInbox();
  const blocked = inbox.groups.proposed_actions_blocked.find((i) => i.id === a.id);
  assert.ok(blocked);
  assert.equal(blocked.status, "review_required");
  assert.match(blocked.blockedReason ?? "", /approval|review/i);

  reviewWorkflowRun(run.id, "approve", {});
  inbox = getWorkflowInbox();
  assert.equal(inbox.groups.proposed_actions_blocked.length, 0);
  assert.ok(inbox.groups.proposed_actions_ready.find((i) => i.id === a.id));
});

test("a missing-input action is blocked with the exact fields", () => {
  const run = createWorkflowRun({ workflowId: TARGET, title: "done run", status: "done" });
  const a = proposeWorkflowAction({ sourceRunId: run.id, targetWorkflowId: TARGET, title: "Summary", suggestedInputs: { title: "Summary" } });
  const inbox = getWorkflowInbox();
  const item = inbox.groups.proposed_actions_blocked.find((i) => i.id === a.id);
  assert.ok(item);
  assert.equal(item.status, "needs_input");
  assert.match(item.blockedReason ?? "", /url/);
});

test("rejected, changes_requested, failed runs land in the attention/changes groups", () => {
  const r1 = createWorkflowRun({ workflowId: SRC, title: "rej", status: "needs_review" });
  reviewWorkflowRun(r1.id, "reject", {});
  const r2 = createWorkflowRun({ workflowId: SRC, title: "chg", status: "needs_review" });
  reviewWorkflowRun(r2.id, "request_changes", {});
  createWorkflowRun({ workflowId: TARGET, title: "fail", status: "failed" });
  createWorkflowRun({ workflowId: TARGET, title: "ok", status: "done" });

  const inbox = getWorkflowInbox();
  assert.ok(inbox.groups.failed_or_attention.some((i) => i.title === "rej"));
  assert.ok(inbox.groups.changes_requested.some((i) => i.title === "chg"));
  assert.ok(inbox.groups.failed_or_attention.some((i) => i.title === "fail"));
  assert.ok(inbox.groups.recently_completed.some((i) => i.title === "ok"));
});

test("the inbox leaks no secret-looking artifact keys or values", () => {
  const run = createWorkflowRun({ workflowId: SRC, title: "s", status: "needs_review" });
  linkWorkflowRunArtifact(run.id, "sourceText", "notes with token=SHOULD_NOT_APPEAR");
  proposeWorkflowAction({ sourceRunId: run.id, targetWorkflowId: TARGET, title: "Summary", suggestedInputs: { title: "Summary", url: "https://youtu.be/x", sessionCookie: "LEAK" } });
  const blob = JSON.stringify(getWorkflowInbox());
  assert.doesNotMatch(blob, /SHOULD_NOT_APPEAR|LEAK/);
  assert.doesNotMatch(blob, /password|credentialRef|\bcookie\b/i);
});

test("formatWorkflowInboxSummary is concise and operational", () => {
  createWorkflowRun({ workflowId: SRC, title: "a", status: "needs_review" });
  const summary = formatWorkflowInboxSummary(getWorkflowInbox());
  assert.match(summary, /1 need|review/i);
  assert.doesNotMatch(summary, /SHOULD_NOT_APPEAR/);
});
