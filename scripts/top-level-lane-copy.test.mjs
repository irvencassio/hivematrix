import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("top-level operator copy uses lane names", () => {
  const readme = read("README.md");
  const onboarding = read("ONBOARDING.md");

  assert.match(readme, /native desktop-control\s+capability \(Desktop Lane\)/);
  assert.match(readme, /Desktop Lane helper \(\.app, :3748\)/);
  assert.match(readme, /\*\*Desktop Lane\*\*: native helper/);
  assert.doesNotMatch(readme, /DesktopBee/);

  assert.match(onboarding, /## 6\. Desktop Lane — desktop control \(optional\)/);
  assert.match(onboarding, /Desktop Lane helper compatibility bundle: `DesktopBeeHelper\.app`/);
  assert.match(onboarding, /enable \*\*Desktop Lane Helper\*\*/);
  assert.match(onboarding, /Prove it: `npx tsx scripts\/desktopbee-proof\.mts`/);
  assert.doesNotMatch(onboarding, /## 6\. DesktopBee|DesktopBee — desktop control|enable \*\*DesktopBeeHelper\*\*/);
});

test("packaged permission strings use lane names", () => {
  const tauriInfo = read("src-tauri/Info.plist");
  const helperInfo = read("desktopbee-helper/Resources/Info.plist");

  assert.match(tauriInfo, /HiveMatrix uses the microphone for Voice Lane push-to-talk and live voice conversations/);
  assert.doesNotMatch(tauriInfo, /VoiceBee/);

  assert.match(helperInfo, /HiveMatrix Desktop Lane Helper/);
  assert.match(helperInfo, /HiveMatrix Desktop Lane controls scriptable apps on your behalf, with your approval/);
  assert.match(helperInfo, /<string>DesktopBeeHelper<\/string>/);
  assert.doesNotMatch(helperInfo, /HiveMatrix DesktopBee Helper|HiveMatrix DesktopBee controls/);
});

test("voice sidecar and video package copy use Voice Lane wording", () => {
  const voiceFiles = [
    "voice-sidecar/README.md",
    "voice-sidecar/stt.py",
    "voice-sidecar/stream_turn.py",
    "voice-sidecar/talk.py",
    "voice-sidecar/live.py",
    "voice-sidecar/llm.py",
    "voice-sidecar/tts.py",
    "voice-sidecar/test_turn.py",
    "voice-sidecar/smoke_stt.py",
    "voice-sidecar/turn.py",
    "voice-sidecar/requirements.txt",
    "video/package.json",
  ];

  const combined = voiceFiles.map((path) => read(path)).join("\n");
  assert.match(combined, /Voice Lane/);
  assert.doesNotMatch(combined, /VoiceBee/);
});
