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
const scriptPath = args[0];
if (!scriptPath) { console.error("usage: node make.mjs <script.txt> [out.mp4] [--title T]"); process.exit(2); }
const outMp4 = args[1] && !args[1].startsWith("--") ? args[1] : join(OUT, "video.mp4");
const ti = args.indexOf("--title");
const title = ti >= 0 ? args[ti + 1] : "HiveMatrix";
const si = args.indexOf("--screen");
const screenSrc = si >= 0 ? args[si + 1] : null;

mkdirSync(OUT, { recursive: true });
mkdirSync(join(VIDEO_DIR, "public"), { recursive: true });

const scriptText = readFileSync(scriptPath, "utf-8").trim();
const sc = sidecarDir();
const py = join(sc, ".venv", "bin", "python");
const narration = join(VIDEO_DIR, "public", "narration.wav");
const scriptTxt = join(OUT, "script.txt");
const capJson = join(OUT, "captions.json");
const propsPath = join(OUT, "props.json");

writeFileSync(scriptTxt, scriptText);

console.log("→ voiceover (cloned voice)…");
execFileSync(py, [join(sc, "synth_cli.py"), "--text-file", scriptTxt, "--out", narration, "--quality", "high"],
  { cwd: sc, stdio: "inherit" });

console.log("→ caption timings (whisper)…");
execFileSync(py, [join(sc, "word_timings.py"), narration, capJson], { cwd: sc, stdio: "inherit" });
const caps = JSON.parse(readFileSync(capJson, "utf-8"));

const dur = parseFloat(execFileSync("ffprobe",
  ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", narration],
  { encoding: "utf-8" }).trim());

let screenFile;
if (screenSrc) {
  if (!existsSync(screenSrc)) { console.error(`--screen file not found: ${screenSrc}`); process.exit(2); }
  screenFile = "screen" + (screenSrc.match(/\.[a-z0-9]+$/i)?.[0] || ".mp4");
  copyFileSync(screenSrc, join(VIDEO_DIR, "public", screenFile));
  console.log(`→ screen footage: ${screenFile}`);
}

writeFileSync(propsPath, JSON.stringify({ audioFile: "narration.wav", words: caps.words, title, durationInSeconds: dur, ...(screenFile ? { screenFile } : {}) }));

console.log("→ render…");
execFileSync("npx", ["remotion", "render", "src/index.ts", "Narrated", outMp4, `--props=${propsPath}`],
  { cwd: VIDEO_DIR, stdio: "inherit" });

console.log("✅ " + outMp4);
