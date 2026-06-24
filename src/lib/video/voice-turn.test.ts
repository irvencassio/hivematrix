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
