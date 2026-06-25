import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// HOME-isolated so draftsDir() resolves under a temp home (no real ~/.hivematrix writes).
const originalHome = process.env.HOME;
const tmp = mkdtempSync(join(tmpdir(), "hm-publish-draft-"));
process.env.HOME = tmp;

const { saveDraft, getDraft } = await import("./draft-store");
const { publishDraftVideo } = await import("./news-review");

test.after(() => { if (originalHome) process.env.HOME = originalHome; rmSync(tmp, { recursive: true, force: true }); });

function seed(id: string, patch: Record<string, unknown> = {}) {
  return saveDraft({
    id, createdAt: "2026-06-25T10:00:00Z", updatedAt: "2026-06-25T10:00:00Z",
    status: "portal_completed", kind: "ai-news", privacy: "unlisted", title: "Launch", revisions: 0,
    paths: { script: "/s.txt", title: "/t.txt", description: "/d.txt", tags: "/g.txt", video: "/out/final.mp4" },
    ...patch,
  } as never);
}

function recordingDeps() {
  const calls: string[][] = [];
  return {
    calls,
    fileExists: () => true,
    runVideoScript: async (args: string[]) => { calls.push(args); return { stdout: "Uploaded: https://youtu.be/abc123\n", stderr: "" }; },
  };
}

test("portal_completed publishes the local video via publish.mjs and records the YouTube URL", async () => {
  seed("d-pub");
  const deps = recordingDeps();
  const result = await publishDraftVideo("d-pub", deps);
  assert.equal(result.ok, true);
  assert.equal(result.published, true);
  assert.equal(result.youtubeUrl, "https://youtu.be/abc123");

  // Exactly the publish step ran — never a render.
  assert.equal(deps.calls.length, 1);
  assert.ok(deps.calls[0].includes("publish.mjs"));
  assert.ok(!deps.calls.some((args) => args.some((a) => a.includes("make-avatar.mjs"))), "must not re-render");

  const draft = getDraft("d-pub");
  assert.equal(draft?.status, "published");
  assert.equal(draft?.youtubeUrl, "https://youtu.be/abc123");
});

test("needs_publish_input refuses to publish (no local file) and never runs a script", async () => {
  seed("d-needs", { status: "needs_publish_input", portalVideoUrl: "https://app.heygen.com/v/x" });
  const deps = recordingDeps();
  const result = await publishDraftVideo("d-needs", deps);
  assert.equal(result.ok, false);
  assert.equal(result.code, "needs_publish_input");
  assert.match(result.reason ?? "", /local|manual|no local file/i);
  assert.equal(deps.calls.length, 0);
  assert.equal(getDraft("d-needs")?.status, "needs_publish_input"); // unchanged
});

test("already-published draft is idempotent and does not re-upload", async () => {
  seed("d-done", { status: "published", youtubeUrl: "https://youtu.be/already" });
  const deps = recordingDeps();
  const result = await publishDraftVideo("d-done", deps);
  assert.equal(result.ok, true);
  assert.equal(result.published, true);
  assert.equal(result.alreadyPublished, true);
  assert.equal(result.youtubeUrl, "https://youtu.be/already");
  assert.equal(deps.calls.length, 0);
});

test("a portal_completed draft whose local video is missing refuses clearly", async () => {
  seed("d-missing");
  const result = await publishDraftVideo("d-missing", {
    fileExists: () => false,
    runVideoScript: async () => { throw new Error("should not run"); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "missing_video");
});

test("a draft that is not portal_completed is not publishable via this path", async () => {
  seed("d-review", { status: "review" });
  const deps = recordingDeps();
  const result = await publishDraftVideo("d-review", deps);
  assert.equal(result.ok, false);
  assert.equal(result.code, "not_publishable");
  assert.equal(deps.calls.length, 0);
});

test("the publish result carries no secret material", async () => {
  seed("d-clean");
  const result = await publishDraftVideo("d-clean", recordingDeps());
  assert.doesNotMatch(JSON.stringify(result), /password|cookie|secret|credentialRef|\btoken\b/i);
});
