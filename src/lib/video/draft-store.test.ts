import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("draft store round-trips and lists newest-first", async (t) => {
  const originalHome = process.env.HOME;
  const tmp = mkdtempSync(join(tmpdir(), "hm-video-drafts-"));
  process.env.HOME = tmp;
  t.after(() => { if (originalHome) process.env.HOME = originalHome; rmSync(tmp, { recursive: true, force: true }); });

  // Import AFTER HOME is set so draftsDir() resolves under the temp home.
  const { saveDraft, getDraft, listDrafts, updateDraft, pendingDrafts } = await import("./draft-store");

  const base = (id: string, createdAt: string) => ({
    id, createdAt, updatedAt: createdAt, status: "review" as const, kind: "ai-news", privacy: "unlisted",
    title: "Top AI News", revisions: 0,
    paths: { script: "/s.txt", title: "/t.txt", description: "/d.txt", tags: "/g.txt", video: "/v.mp4" },
  });

  saveDraft(base("a", "2026-06-23T10:00:00Z"));
  saveDraft(base("b", "2026-06-23T11:00:00Z"));

  assert.equal(getDraft("a")?.title, "Top AI News");
  assert.equal(getDraft("missing"), null);

  const list = listDrafts();
  assert.deepEqual(list.map((d) => d.id), ["b", "a"], "newest first");
  assert.equal(pendingDrafts().length, 2);

  const updated = updateDraft("a", { status: "published", youtubeUrl: "https://youtu.be/x" });
  assert.equal(updated?.status, "published");
  assert.equal(getDraft("a")?.youtubeUrl, "https://youtu.be/x");
  assert.equal(pendingDrafts().length, 1, "published draft drops out of pending");
  assert.equal(updateDraft("missing", { status: "error" }), null);
});
