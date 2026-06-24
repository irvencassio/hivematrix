import test from "node:test";
import assert from "node:assert/strict";
import { detectVideoVoiceIntent } from "./voice-intent";

test("read-aloud", () => {
  assert.equal(detectVideoVoiceIntent("read me the script").kind, "read");
  assert.equal(detectVideoVoiceIntent("read the video script").kind, "read");
  assert.equal(detectVideoVoiceIntent("read the draft").kind, "read");
});

test("approve / cancel the video", () => {
  assert.equal(detectVideoVoiceIntent("approve the video").kind, "approve");
  assert.equal(detectVideoVoiceIntent("publish the video").kind, "approve");
  assert.equal(detectVideoVoiceIntent("ship the news script").kind, "approve");
  assert.equal(detectVideoVoiceIntent("cancel the video").kind, "cancel");
  assert.equal(detectVideoVoiceIntent("scrap the draft").kind, "cancel");
});

test("rework with feedback", () => {
  assert.deepEqual(detectVideoVoiceIntent("rework the video, cut the third story"), { kind: "rework", feedback: "cut the third story" });
  assert.equal(detectVideoVoiceIntent("regenerate the script").kind, "rework");
});

test("non-video utterances fall through", () => {
  assert.equal(detectVideoVoiceIntent("approve it").kind, "none", "no video noun → not ours");
  assert.equal(detectVideoVoiceIntent("what's on my board").kind, "none");
  assert.equal(detectVideoVoiceIntent("").kind, "none");
});
