import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-feedback-test-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { recordFeedback, listFeedback, setFeedbackStatus, feedbackSummary } = await import("./feedback");

_resetDbForTests();
getDb();

test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

test("records bugs and enhancements and lists them newest-first", () => {
  const bug = recordFeedback({ kind: "bug", title: "iMessage poller misses attachments", detail: "no attributedBody decode", source: "imessage" });
  const enh = recordFeedback({ kind: "enhancement", title: "Add a weekly digest directive" });

  assert.equal(bug.kind, "bug");
  assert.equal(bug.status, "open");
  assert.equal(bug.source, "imessage");
  assert.equal(enh.kind, "enhancement");

  const all = listFeedback();
  assert.equal(all.length, 2);
  assert.equal(all[0]._id, enh._id, "newest first");
});

test("filters by kind and status", () => {
  assert.equal(listFeedback({ kind: "bug" }).length, 1);
  assert.equal(listFeedback({ kind: "enhancement" }).length, 1);
  assert.equal(listFeedback({ status: "open" }).length, 2);
  assert.equal(listFeedback({ status: "done" }).length, 0);
});

test("status transitions and summary counts", () => {
  const [first] = listFeedback({ kind: "bug" });
  const updated = setFeedbackStatus(first._id, "triaged");
  assert.equal(updated?.status, "triaged");
  assert.ok(updated && updated.updatedAt >= updated.createdAt);

  const summary = feedbackSummary();
  assert.equal(summary.total, 2);
  assert.equal(summary.byKind.bug, 1);
  assert.equal(summary.byKind.enhancement, 1);
  assert.equal(summary.byStatus.triaged, 1);
  assert.equal(summary.byStatus.open, 1);
  assert.equal(summary.open, 1);
});

test("a blank title is rejected; unknown status throws", () => {
  assert.throws(() => recordFeedback({ kind: "bug", title: "   " }));
  const [item] = listFeedback();
  assert.throws(() => setFeedbackStatus(item._id, "bogus" as never));
  assert.equal(setFeedbackStatus("no-such-id", "done"), null);
});
