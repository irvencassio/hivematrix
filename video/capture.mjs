/**
 * Screen recorder for how-to footage (Phase 4, P4.3).
 *
 *   node capture.mjs [seconds] [out.mp4]
 *
 * Records the main display via ffmpeg/avfoundation, then feed it to make.mjs:
 *   node make.mjs script.txt out.mp4 --screen out/screen.mp4 --title "..."
 *
 * First run, grant Screen Recording to your terminal:
 *   System Settings → Privacy & Security → Screen Recording.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VIDEO_DIR = dirname(fileURLToPath(import.meta.url));
const seconds = parseFloat(process.argv[2] || "15");
const out = process.argv[3] || join(VIDEO_DIR, "out", "screen.mp4");
mkdirSync(dirname(out), { recursive: true });

// Find the "Capture screen 0" avfoundation device index (it varies by machine).
const list = spawnSync("ffmpeg", ["-f", "avfoundation", "-list_devices", "true", "-i", ""], { encoding: "utf-8" }).stderr || "";
const m = list.match(/\[(\d+)\]\s+Capture screen 0/);
if (!m) {
  console.error("Could not find a screen-capture device. ffmpeg listed:\n" + list);
  console.error("Grant Screen Recording to your terminal: System Settings → Privacy & Security → Screen Recording, then retry.");
  process.exit(1);
}
const idx = m[1];

console.log(`Recording the screen for ${seconds}s (device ${idx}). Switch to what you're demoing…`);
for (const n of [3, 2, 1]) { process.stdout.write(`${n}… `); spawnSync("sleep", ["1"]); }
console.log("● recording");

execFileSync("ffmpeg", [
  "-y", "-f", "avfoundation", "-capture_cursor", "1", "-framerate", "30",
  "-i", idx, "-t", String(seconds),
  "-vf", "scale=1920:-2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
  out,
], { stdio: "inherit" });

console.log("✅ " + out);
