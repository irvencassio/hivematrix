import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVideoAgentPayload,
  buildVideoAgentPrompt,
  buildVideoAgentStylesPath,
  extractCompletedVideoUrl,
  extractVideoAgentSession,
} from "./heygen.mjs";

test("buildVideoAgentPrompt wraps script text with creative direction", () => {
  const prompt = buildVideoAgentPrompt({
    scriptText: "Today in AI, three shifts matter.",
    creativeBrief: "Use the polished HeyGen portal look with crisp pacing.",
  });

  assert.match(prompt, /Create a polished presenter video/);
  assert.match(prompt, /animated text cards/);
  assert.match(prompt, /closing CTA/);
  assert.match(prompt, /Creative brief:\nUse the polished HeyGen portal look/);
  assert.match(prompt, /Script:\nToday in AI, three shifts matter\./);
});

test("buildVideoAgentPrompt accepts an explicit agent prompt", () => {
  assert.equal(
    buildVideoAgentPrompt({ agentPrompt: "Make a direct-to-camera market update." }),
    "Make a direct-to-camera market update.",
  );
});

test("buildVideoAgentPayload maps options to HeyGen Video Agent fields", () => {
  assert.deepEqual(
    buildVideoAgentPayload({
      scriptText: "Explain the release.",
      creativeBrief: "Bright studio, energetic but credible.",
      avatarId: "avatar-123",
      voiceId: "voice-456",
      styleId: "style-789",
      orientation: "portrait",
      files: ["asset-1"],
      callbackUrl: "https://example.com/hook",
      callbackId: "job-42",
    }),
    {
      prompt: buildVideoAgentPrompt({
        scriptText: "Explain the release.",
        creativeBrief: "Bright studio, energetic but credible.",
      }),
      avatar_id: "avatar-123",
      voice_id: "voice-456",
      style_id: "style-789",
      orientation: "portrait",
      files: ["asset-1"],
      callback_url: "https://example.com/hook",
      callback_id: "job-42",
    },
  );
});

test("buildVideoAgentPayload omits blank optional fields", () => {
  assert.deepEqual(buildVideoAgentPayload({ agentPrompt: "Make it clean.", styleId: "" }), {
    prompt: "Make it clean.",
  });
});

test("buildVideoAgentStylesPath builds a stable query path", () => {
  assert.equal(buildVideoAgentStylesPath(), "/v3/video-agents/styles");
  assert.equal(
    buildVideoAgentStylesPath({ tag: "news studio", limit: 25, token: "next/page" }),
    "/v3/video-agents/styles?tag=news+studio&limit=25&token=next%2Fpage",
  );
});

test("extractVideoAgentSession reads session, status, and early video id", () => {
  assert.deepEqual(
    extractVideoAgentSession({
      data: { session_id: "session-1", status: "processing", video_id: "video-1" },
    }),
    { sessionId: "session-1", status: "processing", videoId: "video-1" },
  );
});

test("extractVideoAgentSession rejects malformed responses", () => {
  assert.throws(() => extractVideoAgentSession({ data: { status: "queued" } }), /No session_id/);
});

test("extractCompletedVideoUrl returns completed video URLs and waits otherwise", () => {
  assert.equal(
    extractCompletedVideoUrl({ data: { status: "completed", video_url: "https://cdn.example/video.mp4" } }),
    "https://cdn.example/video.mp4",
  );
  assert.equal(extractCompletedVideoUrl({ data: { status: "processing" } }), null);
});

test("extractCompletedVideoUrl throws on failed video responses", () => {
  assert.throws(
    () => extractCompletedVideoUrl({ data: { status: "failed", error: { message: "render broke" } } }),
    /render broke/,
  );
});
