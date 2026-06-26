import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// HOME-isolated so draftsDir() resolves under a temp home (no real ~/.hivematrix writes).
const originalHome = process.env.HOME;
const tmp = mkdtempSync(join(tmpdir(), "hm-portal-completion-"));
process.env.HOME = tmp;

const { saveDraft, getDraft } = await import("./draft-store");
const {
  normalizeHeyGenPortalCompletion,
  applyHeyGenPortalCompletion,
  markPortalTaskCreated,
  portalChildPending,
  portalReviewCopy,
} = await import("./portal-completion");

test.after(() => { if (originalHome) process.env.HOME = originalHome; rmSync(tmp, { recursive: true, force: true }); });

function seedDraft(id: string, patch: Record<string, unknown> = {}) {
  return saveDraft({
    id, createdAt: "2026-06-25T10:00:00Z", updatedAt: "2026-06-25T10:00:00Z",
    status: "portal_pending", kind: "ai-news", privacy: "unlisted", title: "Launch", revisions: 0,
    paths: { script: "/s.txt", title: "/t.txt", description: "/d.txt", tags: "/g.txt", video: "/v.mp4" },
    portalTaskId: "child-1",
    ...patch,
  } as never);
}

// Capture review-task updates without a live DB.
const taskUpdates: Array<{ id: string; fields: Record<string, unknown> }> = [];
const deps = {
  fileExists: (p: string) => p.endsWith(".mp4"),
  updateTask: async (id: string, fields: Record<string, unknown>) => { taskUpdates.push({ id, fields }); },
};

test("normalizer requires parentDraftId and rejects secret-looking fields", () => {
  assert.throws(() => normalizeHeyGenPortalCompletion({}), /parentDraftId/i);
  assert.throws(() => normalizeHeyGenPortalCompletion({ parentDraftId: "d", sessionCookie: "x" }), /secret|cookie|not allowed/i);
  const ok = normalizeHeyGenPortalCompletion({ parentDraftId: "d", finalVideoUrl: "https://app.heygen.com/v/123" });
  assert.equal(ok.parentDraftId, "d");
  assert.equal(ok.finalVideoUrl, "https://app.heygen.com/v/123");
});

test("local video path → portal_completed and the existing publish path can continue", async () => {
  seedDraft("d-local", { taskId: "review-1" });
  const result = await applyHeyGenPortalCompletion({ parentDraftId: "d-local", childTaskId: "child-1", localVideoPath: "/Users/me/heygen-out.mp4" }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.status, "portal_completed");
  const draft = getDraft("d-local");
  assert.equal(draft?.status, "portal_completed");
  assert.equal(draft?.paths.video, "/Users/me/heygen-out.mp4");
  assert.ok(draft?.portalCompletedAt);
  assert.equal(draft?.portalResolvedTaskId, "child-1");
  assert.equal(draft?.youtubeUrl, undefined); // NOT published
});

test("URL / manual note only → needs_publish_input, never a fake YouTube publish", async () => {
  seedDraft("d-url");
  const result = await applyHeyGenPortalCompletion({ parentDraftId: "d-url", childTaskId: "child-1", finalVideoUrl: "https://app.heygen.com/v/abc", manualCompletionNote: "Exported in portal" }, deps);
  assert.equal(result.status, "needs_publish_input");
  const draft = getDraft("d-url");
  assert.equal(draft?.status, "needs_publish_input");
  assert.equal(draft?.portalVideoUrl, "https://app.heygen.com/v/abc");
  assert.equal(draft?.manualCompletionNote, "Exported in portal");
  assert.equal(draft?.youtubeUrl, undefined);     // not published
  assert.notEqual(draft?.status, "published");
});

test("re-processing the same child task is idempotent (no duplicate effect)", async () => {
  seedDraft("d-idem");
  await applyHeyGenPortalCompletion({ parentDraftId: "d-idem", childTaskId: "child-1", finalVideoUrl: "https://app.heygen.com/v/1" }, deps);
  const first = getDraft("d-idem");
  const again = await applyHeyGenPortalCompletion({ parentDraftId: "d-idem", childTaskId: "child-1", finalVideoUrl: "https://app.heygen.com/v/SHOULD-NOT-OVERWRITE" }, deps);
  assert.equal(again.alreadyProcessed, true);
  const after = getDraft("d-idem");
  assert.equal(after?.portalVideoUrl, first?.portalVideoUrl); // unchanged
  assert.equal(after?.portalVideoUrl, "https://app.heygen.com/v/1");
});

test("failed / cancelled child keeps the parent recoverable (back to review, child cleared)", async () => {
  for (const childStatus of ["failed", "cancelled"] as const) {
    seedDraft(`d-${childStatus}`, { taskId: "review-x" });
    const result = await applyHeyGenPortalCompletion({ parentDraftId: `d-${childStatus}`, childTaskId: "child-1", childStatus, manualCompletionNote: "portal could not finish" }, deps);
    assert.equal(result.ok, true);
    const draft = getDraft(`d-${childStatus}`);
    assert.equal(draft?.status, "review", `${childStatus} → recoverable review`);
    assert.equal(draft?.portalTaskId, undefined, "cleared so a retry creates a fresh child");
    assert.equal(draft?.portalResolvedTaskId, "child-1");
  }
});

test("missing draft fails clearly and writes nothing", async () => {
  const result = await applyHeyGenPortalCompletion({ parentDraftId: "nope", childTaskId: "c", finalVideoUrl: "https://x" }, deps);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /draft/i);
});

test("markPortalTaskCreated sets portal_pending and the dup guard prevents a second child", async () => {
  saveDraft({
    id: "d-mark", createdAt: "2026-06-25T10:00:00Z", updatedAt: "2026-06-25T10:00:00Z",
    status: "review", kind: "ai-news", privacy: "unlisted", title: "Launch", revisions: 0,
    paths: { script: "/s", title: "/t", description: "/d", tags: "/g", video: "/v.mp4" },
  } as never);
  await markPortalTaskCreated("d-mark", "child-9", deps);
  const draft = getDraft("d-mark");
  assert.equal(draft?.status, "portal_pending");
  assert.equal(draft?.portalTaskId, "child-9");
  assert.equal(portalChildPending(draft!), true);
  assert.equal(portalChildPending(draft!, true), false); // force overrides
  assert.match(portalReviewCopy(draft!), /portal/i);
});

test("portal review task updates use real task columns only", async () => {
  taskUpdates.length = 0;
  seedDraft("d-real-cols", { taskId: "review-real" });
  await applyHeyGenPortalCompletion({ parentDraftId: "d-real-cols", childTaskId: "child-1", localVideoPath: "/Users/me/final.mp4" }, deps);
  assert.ok(taskUpdates.length > 0);
  const fields = taskUpdates.at(-1)?.fields ?? {};
  assert.deepEqual(Object.keys(fields).sort(), ["description", "error", "reviewState", "status"]);
  assert.equal(fields.status, "review");
  assert.equal(fields.reviewState, "needs_input");
  assert.match(String(fields.description), /ready to publish/i);
  assert.equal("portalState" in fields, false);
  assert.equal("portalNote" in fields, false);
});

test("completion metadata carries linkage and no secrets", async () => {
  seedDraft("d-meta", { taskId: "review-m" });
  await applyHeyGenPortalCompletion({ parentDraftId: "d-meta", childTaskId: "child-1", localVideoPath: "/Users/me/final.mp4" }, deps);
  const blob = JSON.stringify(getDraft("d-meta")) + JSON.stringify(taskUpdates);
  assert.match(blob, /child-1|d-meta/);
  assert.doesNotMatch(blob, /password|cookie|secret|session=|credentialRef|\btoken\b/i);
});
