import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalHome = process.env.HOME;
const originalDb = process.env.HIVEMATRIX_DB_PATH;
const tmp = mkdtempSync(join(tmpdir(), "hm-news-review-"));
process.env.HOME = tmp;
process.env.HIVEMATRIX_DB_PATH = join(tmp, "test.db");

const { _resetDbForTests, Task } = await import("@/lib/db");
const { saveDraft, getDraft } = await import("./draft-store");
const { resolveVideoDraft } = await import("./news-review");

test.after(() => {
  _resetDbForTests();
  if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
  if (originalDb) process.env.HIVEMATRIX_DB_PATH = originalDb; else delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(tmp, { recursive: true, force: true });
});

async function seedReviewDraft(id: string) {
  const dir = join(tmp, "video");
  mkdirSync(dir, { recursive: true });
  const script = join(dir, `${id}-script.txt`);
  writeFileSync(script, "Here is the approved script.");
  const task = await Task.create({
    _id: `task-${id}`,
    title: "Review video script: Launch",
    description: "Review this script",
    project: "hivematrix",
    projectPath: tmp,
    status: "review",
    reviewState: "needs_input",
    executor: "video-review",
    source: "video",
    output: { videoDraftId: id, reviewScript: "Here is the approved script." },
  });
  saveDraft({
    id,
    createdAt: "2026-06-26T10:00:00Z",
    updatedAt: "2026-06-26T10:00:00Z",
    status: "review",
    kind: "ai-news",
    privacy: "unlisted",
    title: "Launch",
    revisions: 0,
    taskId: task._id,
    paths: { script, title: join(dir, "title.txt"), description: join(dir, "description.txt"), tags: join(dir, "tags.txt"), video: join(dir, "out.mp4") },
  });
  return { script, taskId: task._id };
}

test("approving a reviewed script creates a Browser Lane portal child instead of rendering through the API", async () => {
  await seedReviewDraft("d-portal");
  const created: Array<{ draftId: string; script: string; title: string }> = [];

  const result = await resolveVideoDraft("d-portal", "approve", {
    createPortalTask: async ({ draft, script, title }) => {
      created.push({ draftId: draft.id, script, title });
      return { status: "created", taskId: "browser-child-1" };
    },
  });

  assert.equal(result?.decision.action, "approve");
  assert.equal(created.length, 1);
  assert.equal(created[0].draftId, "d-portal");
  assert.match(created[0].script, /approved script/);
  assert.equal(getDraft("d-portal")?.status, "portal_pending");
  assert.equal(getDraft("d-portal")?.portalTaskId, "browser-child-1");

  const parent = await Task.findById("task-d-portal");
  assert.equal(parent?.status, "in_progress");
  assert.equal(parent?.reviewState, null);
  assert.match(parent?.description ?? "", /Browser Lane|portal/i);
  assert.doesNotMatch(JSON.stringify(parent), /make-avatar\.mjs/);
  assert.match(result?.reply ?? "", /Browser Lane|portal/i);
});

test("approval blocked by Browser Lane readiness stays in review with an honest error", async () => {
  await seedReviewDraft("d-blocked");

  const result = await resolveVideoDraft("d-blocked", "approve", {
    createPortalTask: async () => ({
      status: "readiness_required",
      taskId: null,
      reason: "HeyGen site needs re-authentication",
    }),
  });

  assert.equal(result?.decision.action, "approve");
  assert.equal(getDraft("d-blocked")?.status, "review");
  assert.equal(getDraft("d-blocked")?.portalTaskId, undefined);
  const parent = await Task.findById("task-d-blocked");
  assert.equal(parent?.status, "review");
  assert.equal(parent?.reviewState, "needs_input");
  assert.match(parent?.error ?? "", /Browser Lane|re-authentication/i);
  assert.match(result?.reply ?? "", /needs attention|Browser Lane|re-authentication/i);
});
