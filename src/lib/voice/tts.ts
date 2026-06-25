/**
 * Text-to-speech for the voice persona (DECISIONS Q12 / Voice Lane).
 *
 * The engine is swappable behind `synthesizeSpeech()`. Today it uses macOS `say`
 * (built-in, zero setup) so the iMessage voice-reply pipeline works end-to-end
 * right now. P1.1/P1.2 of the voice/video plan swap in a local cloned-voice
 * engine (F5-TTS / Chatterbox via mlx-audio) behind this same signature — callers
 * don't change. Output is an .m4a (AAC) under ~/.hivematrix/uploads, the same
 * non-sandboxed dir the iMessage send path can attach from.
 */

import { execFile } from "child_process";
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";
import { buildCliPath } from "@/lib/config/binary-detection";
import { voiceRuntime } from "./runtime";

export type TtsEngine = "say" | "cloned";

export interface TtsOptions {
  /** Engine voice id. For `say`, a macOS voice name (e.g. "Samantha"). */
  voice?: string;
  /** Output directory. Default ~/.hivematrix/uploads. */
  outDir?: string;
  /** Filename stem; default random. */
  id?: string;
  timeoutMs?: number;
  /** Force an engine. Default: cloned when available, else say. */
  engine?: TtsEngine;
}

export interface TtsResult {
  path: string;
  engine: TtsEngine;
}

/** Where synthesized audio lands — an allowlisted dir for the iMessage send path. */
export function voiceOutputDir(base: string = homedir()): string {
  return join(base, ".hivematrix", "uploads");
}

/** The cloned voice profile the operator recorded (voice-sidecar/record_voice.py). */
export function voiceProfilePath(base: string = homedir()): string {
  return join(base, ".hivematrix", "voice", "profile.wav");
}

/** True when a recorded profile AND a usable voice runtime are both present. */
export function clonedVoiceAvailable(): boolean {
  return existsSync(voiceProfilePath()) && voiceRuntime() !== null;
}

/** Synthesize via the sidecar's cloned voice. Resolves null on any failure. */
function synthesizeCloned(txtPath: string, outPath: string, timeoutMs: number): Promise<TtsResult | null> {
  return new Promise((resolve) => {
    const rt = voiceRuntime();
    if (!rt) { resolve(null); return; }
    const args = [join(rt.scriptsDir, "synth_cli.py"), "--text-file", txtPath, "--out", outPath, "--quality", "high"];
    execFile(rt.python, args, { cwd: rt.scriptsDir, timeout: timeoutMs, env: { ...process.env, PATH: buildCliPath() } }, (err, _stdout, stderr) => {
      if (err || !existsSync(outPath)) {
        console.error(`[voice] cloned synth failed, falling back to say: ${(stderr || err?.message || "").trim()}`);
        resolve(null);
        return;
      }
      resolve({ path: outPath, engine: "cloned" });
    });
  });
}

function synthesizeSay(txtPath: string, outPath: string, voice: string | undefined, timeoutMs: number): Promise<TtsResult> {
  return new Promise((resolve, reject) => {
    const args: string[] = [];
    if (voice) args.push("-v", voice);
    args.push("-o", outPath, "-f", txtPath);
    execFile("say", args, { timeout: timeoutMs }, (err, _stdout, stderr) => {
      if (err) { reject(new Error(`say failed: ${(stderr || err.message || "").trim()}`)); return; }
      resolve({ path: outPath, engine: "say" });
    });
  });
}

/**
 * Synthesize `text` to an .m4a and return its absolute path. Uses the operator's
 * cloned VoxCPM2 voice when available (a recorded profile + the Python sidecar),
 * else falls back to macOS `say`. Cloning runs out-of-process in the sidecar, so
 * the daemon stays Node-only. Text passes via a temp file (never argv).
 */
export async function synthesizeSpeech(text: string, opts: TtsOptions = {}): Promise<TtsResult> {
  const clean = (text ?? "").trim();
  if (!clean) throw new Error("synthesizeSpeech: empty text");

  const dir = opts.outDir ?? voiceOutputDir();
  try { mkdirSync(dir, { recursive: true }); } catch { /* best effort */ }

  const id = opts.id ?? randomBytes(6).toString("hex");
  const outPath = join(dir, `voice-${id}.m4a`);
  const txtPath = join(dir, `voice-${id}.txt`);
  writeFileSync(txtPath, clean);

  const sayTimeout = opts.timeoutMs ?? 30_000;
  try {
    // Cloned voice (out-of-process, slower) unless the caller forced `say`.
    if (opts.engine !== "say" && clonedVoiceAvailable()) {
      const cloned = await synthesizeCloned(txtPath, outPath, Math.max(sayTimeout, 120_000));
      if (cloned) return cloned;
    }
    return await synthesizeSay(txtPath, outPath, opts.voice, sayTimeout);
  } finally {
    try { unlinkSync(txtPath); } catch { /* ignore */ }
  }
}

/**
 * Detect an explicit request for a spoken/voice reply in inbound text. Used to
 * decide whether a Message Lane result is sent back as a voice note vs plain text.
 * Deliberately conservative — only triggers on a clear ask.
 */
export function wantsVoiceReply(text: string): boolean {
  const t = (text ?? "").toLowerCase();
  return /\b(in voice|as (?:a )?voice|voice note|voice memo|voice message|voice reply|say it|read it (?:to me|back|aloud|out loud)|out loud|as audio|audio (?:note|message|reply)|speak (?:it|this|that))\b/.test(t);
}
