/**
 * Video factory orchestrator (Phase 4): script → narrated, captioned MP4.
 *
 *   node make.mjs <script.txt> [out.mp4] [--title "..."]
 *
 * Pipeline: cloned-voice voiceover (sidecar synth_cli) → word timings (whisper)
 * → Remotion render. The "Narrated" composition pairs the audio with karaoke
 * captions over a branded background (screen-recording slot comes next).
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VIDEO_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(VIDEO_DIR, "..");
const OUT = join(VIDEO_DIR, "out");

function sidecarDir() {
  const cands = [process.env.HIVE_VOICE_SIDECAR, join(REPO, "voice-sidecar"),
    join(homedir(), "hivematrix", "voice-sidecar")].filter(Boolean);
  for (const d of cands) if (existsSync(join(d, ".venv", "bin", "python"))) return d;
  throw new Error("voice-sidecar venv not found (set HIVE_VOICE_SIDECAR)");
}

const args = process.argv.slice(2);
const flag = (name, def = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const title = flag("--title", "HiveMatrix");
const screenSrc = flag("--screen");
const lang = flag("--lang", "en");
const musicSrc = flag("--music");
const presenterSrc = flag("--presenter");
const topic = flag("--topic");
const seconds = flag("--seconds", "30");

// Positionals (skip each flag + its value): [scriptFile?] [out.mp4?]
const positionals = [];
for (let i = 0; i < args.length; i++) { if (args[i].startsWith("--")) { i++; continue; } positionals.push(args[i]); }
const scriptPath = topic ? null : positionals[0];
const outMp4 = positionals.find((p) => p.endsWith(".mp4")) || join(OUT, "video.mp4");

if (!topic && !scriptPath) {
  console.error('usage: node make.mjs <script.txt> [out.mp4] [--title T] [--lang it] [--screen f] [--music f] [--presenter f]\n' +
    '   or: node make.mjs --topic "..." [out.mp4] [--seconds 30] [--lang it] [--title T] [--screen f] [--music f] [--presenter f]');
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(join(VIDEO_DIR, "public"), { recursive: true });

const sc = sidecarDir();
const py = join(sc, ".venv", "bin", "python");
const narration = join(VIDEO_DIR, "public", "narration.wav");
const scriptTxt = join(OUT, "script.txt");
const capJson = join(OUT, "captions.json");
const propsPath = join(OUT, "props.json");

let scriptText;
if (topic) {
  console.log(`→ drafting script (topic, lang=${lang})…`);
  execFileSync(py, [join(sc, "script_gen.py"), "--topic", topic, "--lang", lang, "--seconds", seconds, "--out", scriptTxt],
    { cwd: sc, stdio: "inherit" });
  scriptText = readFileSync(scriptTxt, "utf-8").trim();
  console.log(`  script: ${scriptText.slice(0, 90)}…`);
} else {
  scriptText = readFileSync(scriptPath, "utf-8").trim();
  writeFileSync(scriptTxt, scriptText);
}

console.log(`→ voiceover (cloned voice, lang=${lang})…`);
execFileSync(py, [join(sc, "synth_cli.py"), "--text-file", scriptTxt, "--out", narration, "--quality", "high", "--lang", lang],
  { cwd: sc, stdio: "inherit" });

console.log("→ caption timings (whisper)…");
execFileSync(py, [join(sc, "word_timings.py"), narration, capJson, "--lang", lang], { cwd: sc, stdio: "inherit" });
const caps = JSON.parse(readFileSync(capJson, "utf-8"));

const dur = parseFloat(execFileSync("ffprobe",
  ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", narration],
  { encoding: "utf-8" }).trim());

function stage(src, base) {
  if (!existsSync(src)) { console.error(`file not found: ${src}`); process.exit(2); }
  const name = base + (src.match(/\.[a-z0-9]+$/i)?.[0] || ".mp4");
  copyFileSync(src, join(VIDEO_DIR, "public", name));
  return name;
}
let screenFile, musicFile, presenterFile;
if (screenSrc) { screenFile = stage(screenSrc, "screen"); console.log(`→ screen footage: ${screenFile}`); }
if (musicSrc) { musicFile = stage(musicSrc, "music"); console.log(`→ music bed: ${musicFile}`); }
if (presenterSrc) { presenterFile = stage(presenterSrc, "presenter"); console.log(`→ presenter clip: ${presenterFile}`); }

writeFileSync(propsPath, JSON.stringify({
  audioFile: "narration.wav", words: caps.words, title, durationInSeconds: dur,
  ...(screenFile ? { screenFile } : {}), ...(musicFile ? { musicFile } : {}),
  ...(presenterFile ? { presenterFile } : {}),
}));

console.log("→ render…");
execFileSync("npx", ["remotion", "render", "src/index.ts", "Narrated", outMp4, `--props=${propsPath}`],
  { cwd: VIDEO_DIR, stdio: "inherit" });

console.log("✅ " + outMp4);
