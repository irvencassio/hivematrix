import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");

// The streaming (live) path speaks in the warm-worker Kokoro voice. Turn-by-turn
// replies (push-to-talk, deterministic command/skill/briefing) must use the SAME
// voice so they don't sound different from the live stream. synthesizeReplyVoice
// is the single Kokoro-first (say-fallback) entry point; guard that every
// turn-by-turn default routes through it and none fall back to the emergency `say`
// engine directly via synthesizeSpeech.

test("turn-server exposes a Kokoro-first synthesizeReplyVoice with a say fallback", () => {
  const src = read("./turn-server.ts");
  assert.match(src, /export async function synthesizeReplyVoice/);
  // Kokoro first...
  assert.match(src, /return await synthesizeLiveVoice\(clean, lang\)/);
  // ...say only as a fallback.
  assert.match(src, /synthesizeSpeech\(clean\)/);
});

test("command-turn default synthesis uses the unified live voice, not synthesizeSpeech", () => {
  const src = read("./command-turn.ts");
  assert.doesNotMatch(src, /synthesizeSpeech/, "command-turn must not default to the cloned/say voice");
  assert.match(src, /import \{ synthesizeReplyVoice \} from "\.\/turn-server"/);
  assert.match(src, /await synthesizeReplyVoice\(/);
});

test("skill-turn default synthesis uses the unified live voice, not synthesizeSpeech", () => {
  const src = read("./skill-turn.ts");
  assert.doesNotMatch(src, /synthesizeSpeech/, "skill-turn must not default to the cloned/say voice");
  assert.match(src, /import \{ synthesizeReplyVoice \} from "\.\/turn-server"/);
  assert.match(src, /await synthesizeReplyVoice\(/);
});

test("/voice/turn synth is not gated behind voiceRuntime() — it always tries the live voice", () => {
  const src = read("../../daemon/server.ts");
  const turnHandler = src.slice(src.indexOf('urlPath === "/voice/turn"'));
  // Isolate the reply-TTS block (the STT path above legitimately gates on
  // voiceRuntime() to reach the transcription sidecar).
  const ttsStart = turnHandler.indexOf("Optional TTS");
  const block = turnHandler.slice(ttsStart, turnHandler.indexOf("/voice/provision"));
  assert.match(block, /synthesizeReplyVoice\(reply, lang\)/);
  // The old voiceRuntime() gate + direct synthesizeLiveVoice/synthesizeSpeech
  // branches must be gone from the reply-TTS block.
  assert.doesNotMatch(block, /voiceRuntime\(\)/);
  assert.doesNotMatch(block, /synthesizeSpeech/);
});
