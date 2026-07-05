import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { synthesizeSpeech, wantsVoiceReply, voiceOutputDir } from "./tts";

test("wantsVoiceReply triggers only on an explicit spoken-reply ask", () => {
  for (const yes of [
    "summarize my inbox and send it as a voice note",
    "can you read it back to me?",
    "give me the answer in voice please",
    "reply as audio",
    "say it out loud",
    "speak this when done",
  ]) assert.equal(wantsVoiceReply(yes), true, yes);

  for (const no of [
    "can you send me the invoice total?",   // "invoice" must not match
    "what's the weather today?",
    "voice your concerns at the meeting",   // "voice" as a verb, no reply ask
    "summarize the doc",
  ]) assert.equal(wantsVoiceReply(no), false, no);
});

test("voiceOutputDir lands under ~/.hivematrix/uploads", () => {
  assert.equal(voiceOutputDir("/home/me"), "/home/me/.hivematrix/uploads");
});

test("synthesizeSpeech rejects empty text", async () => {
  await assert.rejects(() => synthesizeSpeech("   "), /empty text/);
});

// Real `say` integration — macOS only. Proves the bootstrap engine produces a
// non-empty .m4a the iMessage send path can attach.
test("synthesizeSpeech produces a non-empty .m4a via macOS say", { skip: process.platform !== "darwin" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "tts-"));
  try {
    const res = await synthesizeSpeech("Hello from HiveMatrix.", { outDir: dir, id: "test", engine: "say" });
    assert.equal(res.engine, "say");
    assert.equal(res.path, join(dir, "voice-test.m4a"));
    assert.ok(statSync(res.path).size > 0, "audio file should be non-empty");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("synthesizeSpeech transcodes macOS say output to iOS-playable AAC", { skip: process.platform !== "darwin" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "tts-aac-"));
  try {
    const res = await synthesizeSpeech("Hello from HiveMatrix.", { outDir: dir, id: "aac", engine: "say" });
    const info = execFileSync("afinfo", [res.path], { encoding: "utf-8" });
    assert.match(info, /Data format:\s+1 ch,\s+\d+ Hz,\s+aac\b/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
