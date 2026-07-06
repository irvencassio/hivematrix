/**
 * Emergency text-to-speech fallback for the voice persona (DECISIONS Q12 / Voice Lane).
 *
 * The real voice is Kokoro, produced by the warm turn worker (voice/turn-server.ts →
 * the sidecar's turn_server.py /synth). This module is only the LAST RESORT: when the
 * warm worker can't produce audio, `synthesizeReplyVoice` calls `synthesizeSpeech`
 * here to voice the reply with macOS `say` so a turn is never left silent. It is not a
 * second voice you choose — Kokoro is the voice.
 *
 * Output is an .m4a (AAC) under ~/.hivematrix/uploads, the same non-sandboxed dir the
 * iMessage send path can attach from. Text passes via a temp file (never argv).
 */

import { execFile } from "child_process";
import { mkdirSync, writeFileSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

export interface TtsOptions {
  /** macOS `say` voice name (e.g. "Samantha"). */
  voice?: string;
  /** Output directory. Default ~/.hivematrix/uploads. */
  outDir?: string;
  /** Filename stem; default random. */
  id?: string;
  timeoutMs?: number;
}

export interface TtsResult {
  path: string;
  engine: "say";
}

/** Where synthesized audio lands — an allowlisted dir for the iMessage send path. */
export function voiceOutputDir(base: string = homedir()): string {
  return join(base, ".hivematrix", "uploads");
}

function transcodeToAacM4a(inputPath: string, outPath: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("afconvert", ["-f", "m4af", "-d", "aac", "-b", "64000", inputPath, outPath], { timeout: timeoutMs }, (err, _stdout, stderr) => {
      if (err) { reject(new Error(`afconvert failed: ${(stderr || err.message || "").trim()}`)); return; }
      resolve();
    });
  });
}

function synthesizeSay(txtPath: string, outPath: string, voice: string | undefined, timeoutMs: number): Promise<TtsResult> {
  return new Promise((resolve, reject) => {
    const rawPath = outPath.replace(/\.m4a$/i, ".raw.m4a");
    const args: string[] = [];
    if (voice) args.push("-v", voice);
    args.push("-o", rawPath, "-f", txtPath);
    execFile("say", args, { timeout: timeoutMs }, async (err, _stdout, stderr) => {
      if (err) { reject(new Error(`say failed: ${(stderr || err.message || "").trim()}`)); return; }
      try {
        await transcodeToAacM4a(rawPath, outPath, timeoutMs);
        resolve({ path: outPath, engine: "say" });
      } catch (e) {
        reject(e);
      } finally {
        try { unlinkSync(rawPath); } catch { /* ignore */ }
      }
    });
  });
}

/**
 * Synthesize `text` to an .m4a with macOS `say` and return its absolute path. This
 * is the emergency fallback used when the warm Kokoro worker can't produce audio.
 * Text passes via a temp file (never argv).
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

  const timeout = opts.timeoutMs ?? 30_000;
  try {
    return await synthesizeSay(txtPath, outPath, opts.voice, timeout);
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
