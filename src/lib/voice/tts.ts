/**
 * Text-to-speech for the voice persona (DECISIONS Q12 / VoiceBee).
 *
 * The engine is swappable behind `synthesizeSpeech()`. Today it uses macOS `say`
 * (built-in, zero setup) so the iMessage voice-reply pipeline works end-to-end
 * right now. P1.1/P1.2 of the voice/video plan swap in a local cloned-voice
 * engine (F5-TTS / Chatterbox via mlx-audio) behind this same signature — callers
 * don't change. Output is an .m4a (AAC) under ~/.hivematrix/uploads, the same
 * non-sandboxed dir the iMessage send path can attach from.
 */

import { execFile } from "child_process";
import { mkdirSync, writeFileSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

export type TtsEngine = "say" | "cloned";

export interface TtsOptions {
  /** Engine voice id. For `say`, a macOS voice name (e.g. "Samantha"). */
  voice?: string;
  /** Output directory. Default ~/.hivematrix/uploads. */
  outDir?: string;
  /** Filename stem; default random. */
  id?: string;
  timeoutMs?: number;
}

export interface TtsResult {
  path: string;
  engine: TtsEngine;
}

/** Where synthesized audio lands — an allowlisted dir for the iMessage send path. */
export function voiceOutputDir(base: string = homedir()): string {
  return join(base, ".hivematrix", "uploads");
}

/**
 * Synthesize `text` to an .m4a file and return its absolute path. Bootstrap
 * engine = macOS `say`. Rejects on empty text or synthesis failure.
 *
 * Text is passed via a temp file (`say -f`) rather than argv so a summary that
 * happens to start with "-" can't be misread as a flag, and long text is safe.
 */
export function synthesizeSpeech(text: string, opts: TtsOptions = {}): Promise<TtsResult> {
  return new Promise((resolve, reject) => {
    const clean = (text ?? "").trim();
    if (!clean) { reject(new Error("synthesizeSpeech: empty text")); return; }

    const dir = opts.outDir ?? voiceOutputDir();
    try { mkdirSync(dir, { recursive: true }); } catch { /* best effort */ }

    const id = opts.id ?? randomBytes(6).toString("hex");
    const outPath = join(dir, `voice-${id}.m4a`);
    const txtPath = join(dir, `voice-${id}.txt`);
    try {
      writeFileSync(txtPath, clean);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    const args: string[] = [];
    if (opts.voice) args.push("-v", opts.voice);
    args.push("-o", outPath, "-f", txtPath);

    execFile("say", args, { timeout: opts.timeoutMs ?? 30_000 }, (err, _stdout, stderr) => {
      try { unlinkSync(txtPath); } catch { /* ignore */ }
      if (err) { reject(new Error(`say failed: ${(stderr || err.message || "").trim()}`)); return; }
      resolve({ path: outPath, engine: "say" });
    });
  });
}

/**
 * Detect an explicit request for a spoken/voice reply in inbound text. Used to
 * decide whether a MessageBee result is sent back as a voice note vs plain text.
 * Deliberately conservative — only triggers on a clear ask.
 */
export function wantsVoiceReply(text: string): boolean {
  const t = (text ?? "").toLowerCase();
  return /\b(in voice|as (?:a )?voice|voice note|voice memo|voice message|voice reply|say it|read it (?:to me|back|aloud|out loud)|out loud|as audio|audio (?:note|message|reply)|speak (?:it|this|that))\b/.test(t);
}
