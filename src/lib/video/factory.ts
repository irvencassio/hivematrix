/**
 * Video factory bridge — lets the daemon/agent produce a video by driving the
 * Node `video/` project (Remotion + the voice sidecar). Gated by the `video`
 * feature flag at the call site. Heavy work runs out-of-process (a `node
 * make.mjs` spawn), so the daemon stays responsive.
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/** Locate the `video/` project (with installed deps). Null when absent (shipped
 * .app without the dev project) — the caller falls back / reports unavailable. */
export function videoProjectDir(): string | null {
  const candidates = [
    process.env.HIVE_VIDEO_DIR,
    join(process.cwd(), "video"),
    join(homedir(), "hivematrix", "video"),
  ].filter((d): d is string => !!d);
  for (const d of candidates) {
    if (existsSync(join(d, "make.mjs")) && existsSync(join(d, "node_modules"))) return d;
  }
  return null;
}

export interface VideoMakeOptions {
  topic?: string;        // one-shot: draft the script from a topic
  scriptFile?: string;   // or use an existing script file
  out: string;           // absolute output .mp4 path
  lang?: string;
  title?: string;
  seconds?: number;
  screen?: string;       // screen-recording footage path
  music?: string;        // music bed path
  presenter?: string;    // webcam presenter clip path (PIP)
}

/** Build the argv passed to `node` (make.mjs + flags). Pure → unit-tested. */
export function buildMakeArgs(o: VideoMakeOptions): string[] {
  const args = ["make.mjs"];
  if (o.scriptFile) args.push(o.scriptFile);
  args.push(o.out);
  if (o.topic) args.push("--topic", o.topic);
  if (o.seconds) args.push("--seconds", String(o.seconds));
  if (o.lang) args.push("--lang", o.lang);
  if (o.title) args.push("--title", o.title);
  if (o.screen) args.push("--screen", o.screen);
  if (o.music) args.push("--music", o.music);
  if (o.presenter) args.push("--presenter", o.presenter);
  return args;
}

/** Run the factory. Resolves the output path, rejects on failure. */
export function runVideoFactory(o: VideoMakeOptions, opts: { timeoutMs?: number } = {}): Promise<{ path: string }> {
  return new Promise((resolve, reject) => {
    if (!o.topic && !o.scriptFile) { reject(new Error("topic or scriptFile is required")); return; }
    const dir = videoProjectDir();
    if (!dir) { reject(new Error("video project not found (set HIVE_VIDEO_DIR)")); return; }
    const child = spawn("node", buildMakeArgs(o), { cwd: dir, timeout: opts.timeoutMs ?? 360_000 });
    let stderr = "";
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0 && existsSync(o.out)) resolve({ path: o.out });
      else reject(new Error(`video factory failed (code ${code}): ${stderr.slice(-400).trim()}`));
    });
  });
}
