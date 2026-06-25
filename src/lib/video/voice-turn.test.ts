import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { videoVoiceOverride } from "./voice-turn";

const TMP = mkdtempSync(join(tmpdir(), "hm-video-voice-test-"));
test.after(() => rmSync(TMP, { recursive: true, force: true }));

test("videoVoiceOverride falls through (null) on a non-video transcript", async () => {
  assert.equal(await videoVoiceOverride("what's the weather"), null);
});

const draftBase = (status: string, extra: Record<string, unknown> = {}) => ({
  id: "d1", createdAt: "2026-06-25T10:00:00Z", updatedAt: "2026-06-25T10:00:00Z",
  status, kind: "ai-news", privacy: "unlisted", title: "Launch", revisions: 0,
  paths: { script: "/s.txt", title: "/t.txt", description: "/d.txt", tags: "/g.txt", video: "/v.mp4" },
  ...extra,
});

test("\"publish the video\" on a portal_completed draft publishes WITHOUT re-render", async () => {
  let publishedId = "";
  const ov = await videoVoiceOverride("publish the video", {
    latestDraft: () => draftBase("portal_completed") as never,
    synthesize: async () => "",
    publishDraft: async (id: string) => { publishedId = id; return { ok: true, published: true, draftId: "d1", youtubeUrl: "https://youtu.be/abc" }; },
    resolveDraft: async () => { throw new Error("must not render/approve a portal draft"); },
  });
  assert.ok(ov);
  assert.equal(publishedId, "d1");
  assert.match(ov.reply, /youtu\.be\/abc|published/i);
});

test("\"publish the video\" on a needs_publish_input draft REFUSES and never publishes", async () => {
  let called = 0;
  const ov = await videoVoiceOverride("publish the video", {
    latestDraft: () => draftBase("needs_publish_input", { portalVideoUrl: "https://app.heygen.com/v/x" }) as never,
    synthesize: async () => "",
    publishDraft: async () => { called += 1; return { ok: true, published: true, draftId: "d1" }; },
  });
  assert.ok(ov);
  assert.equal(called, 0, "needs_publish_input must not be published");
  assert.match(ov.reply, /no local|manual|can'?t (upload|publish)/i);
});

test("\"publish the video\" on a portal_pending draft says it is still running", async () => {
  const ov = await videoVoiceOverride("publish the video", {
    latestDraft: () => draftBase("portal_pending", { portalTaskId: "child-1" }) as never,
    synthesize: async () => "",
    publishDraft: async () => { throw new Error("must not publish a pending draft"); },
  });
  assert.ok(ov);
  assert.match(ov.reply, /still running|not (done|finished)|waiting/i);
});

test("a review draft still approves via the existing render+publish path", async () => {
  let resolvedWith = "";
  const ov = await videoVoiceOverride("approve the video", {
    latestDraft: () => draftBase("review") as never,
    synthesize: async () => "",
    resolveDraft: async (_id: string, reply: string) => { resolvedWith = reply; return { reply: "Approved — rendering and publishing." }; },
    publishDraft: async () => { throw new Error("review approve must go through resolveDraft, not publish-only"); },
  });
  assert.ok(ov);
  assert.equal(resolvedWith, "approve");
  assert.match(ov.reply, /approv|render/i);
});

test("voice replies carry no secret material", async () => {
  const ov = await videoVoiceOverride("publish the video", {
    latestDraft: () => draftBase("portal_completed") as never,
    synthesize: async () => "",
    publishDraft: async () => ({ ok: true, published: true, draftId: "d1", youtubeUrl: "https://youtu.be/abc" }),
  });
  assert.doesNotMatch(ov?.reply ?? "", /password|cookie|secret|credentialRef|\btoken\b/i);
});

test("videoVoiceOverride voices the reply via the injected synthesize (live voice)", async () => {
  let spokenText = "";
  const fakeAudio = Buffer.from("kokoro-bytes");
  const synthesize = async (text: string): Promise<string> => {
    spokenText = text;
    const p = join(TMP, "reply.m4a");
    writeFileSync(p, fakeAudio);
    return p;
  };
  // No pending drafts in the test env → the "nothing to review" reply, still spoken.
  const ov = await videoVoiceOverride("read me the video script", { synthesize });
  assert.ok(ov, "should claim the video turn");
  assert.match(ov.reply, /no video script|script for/i);
  assert.equal(spokenText, ov.reply, "synthesize is called with the spoken reply");
  assert.equal(ov.audioBase64, fakeAudio.toString("base64"), "returns audio from the injected voice");
  assert.equal(ov.command.kind, "video-read");
});
