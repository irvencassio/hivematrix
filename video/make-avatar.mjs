#!/usr/bin/env node
/**
 * Avatar-presenter pipeline (Job 3): [topic | script | text] → cloned-voice
 * narration (VoxCPM, Job 2) → HeyGen avatar lip-synced to that narration → MP4.
 * This is the local-first weekly-news pipeline: the VOICE stays on-device (we
 * render it with the operator's cloned voice), and HeyGen only lip-syncs the
 * avatar to our audio — so the voice asset never leaves the Mac.
 *
 *   node make-avatar.mjs <script.txt> [out.mp4] [--avatar <id>] [--lang en]
 *   node make-avatar.mjs --topic "this week in AI" [out.mp4] [--seconds 60]
 *   node make-avatar.mjs --text "Hello, this is the weekly update." [out.mp4]
 *
 * The avatar id defaults to ~/.hivematrix/config.json heygen.avatarId. The HeyGen
 * API key comes from config.json / HEYGEN_API_KEY (see heygen.mjs). To use a
 * HeyGen stock voice instead of the cloned narration, pass --voice <id> (skips
 * the local narration step).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readFileSync as rf } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeAvatarVideo } from "./heygen.mjs";

const VIDEO_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(VIDEO_DIR, "..");
const OUT = join(VIDEO_DIR, "out");

function sidecarDir() {
  const cands = [process.env.HIVE_VOICE_SIDECAR, join(REPO, "voice-sidecar"),
    join(homedir(), "hivematrix", "voice-sidecar")].filter(Boolean);
  for (const d of cands) if (existsSync(join(d, ".venv", "bin", "python"))) return d;
  throw new Error("voice-sidecar venv not found (set HIVE_VOICE_SIDECAR)");
}

function configAvatarId() {
  try {
    const cfg = JSON.parse(rf(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
    return cfg?.heygen?.avatarId || null;
  } catch { return null; }
}

const args = process.argv.slice(2);
const flag = (name, def = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const lang = flag("--lang", "en");
const topic = flag("--topic");
const text = flag("--text");
const seconds = flag("--seconds", "60");
const avatarId = flag("--avatar", configAvatarId());
const voiceId = flag("--voice"); // optional: HeyGen TTS instead of cloned narration

const positionals = [];
for (let i = 0; i < args.length; i++) { if (args[i].startsWith("--")) { i++; continue; } positionals.push(args[i]); }
const scriptPath = topic || text ? null : positionals[0];
const outMp4 = positionals.find((p) => p.endsWith(".mp4")) || join(OUT, "avatar.mp4");

if (!avatarId) {
  console.error("error: no avatar id. Pass --avatar <id> or set heygen.avatarId in ~/.hivematrix/config.json (run `node heygen.mjs --list-avatars`).");
  process.exit(2);
}
if (!topic && !text && !scriptPath) {
  console.error("usage: node make-avatar.mjs <script.txt> [out.mp4] [--avatar id] [--lang en]\n" +
    "   or: node make-avatar.mjs --topic \"...\" [out.mp4] [--seconds 60]\n" +
    "   or: node make-avatar.mjs --text \"...\" [out.mp4]");
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
const sc = sidecarDir();
const py = join(sc, ".venv", "bin", "python");
const scriptTxt = join(OUT, "avatar-script.txt");

// 1. Resolve the script.
let scriptText = text;
if (topic) {
  console.log(`→ drafting script (topic, lang=${lang})…`);
  execFileSync(py, [join(sc, "script_gen.py"), "--topic", topic, "--lang", lang, "--seconds", seconds, "--out", scriptTxt],
    { cwd: sc, stdio: "inherit" });
  scriptText = readFileSync(scriptTxt, "utf-8").trim();
} else if (scriptPath) {
  scriptText = readFileSync(scriptPath, "utf-8").trim();
}
if (scriptText) writeFileSync(scriptTxt, scriptText);
console.log(`  script: ${(scriptText || "").slice(0, 90)}…`);

// 2. Cloned-voice narration (skipped when --voice forces HeyGen TTS).
let audioPath = null;
if (!voiceId) {
  audioPath = join(OUT, "avatar-narration.wav");
  console.log(`→ narration (cloned voice, lang=${lang})…`);
  execFileSync(py, [join(sc, "synth_cli.py"), "--text-file", scriptTxt, "--out", audioPath, "--quality", "high", "--lang", lang],
    { cwd: sc, stdio: "inherit" });
}

// 3. HeyGen avatar render (lip-syncs to our narration, or HeyGen TTS via --voice).
console.log(`→ HeyGen avatar render (avatar ${avatarId})…`);
const out = await makeAvatarVideo({
  scriptText, audioPath, avatarId, voiceId,
  width: 1280, height: 720, outPath: outMp4, pollSeconds: 600,
});
console.log(out);
