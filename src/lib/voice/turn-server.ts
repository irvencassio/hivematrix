/**
 * Push-to-talk worker manager. The old /voice/turn spawned turn_cli.py fresh
 * every turn, so STT and the cloned-voice TTS (VoxCPM) reloaded on
 * EVERY turn — the dominant Talk latency. This keeps one long-lived
 * voice-sidecar/turn_server.py alive with both models warm; /voice/turn relays a
 * single turn to it (transcribe + LLM + synth, no reload).
 *
 * Modeled on realtime-session.ts: lazy spawn on first turn, reuse, same voice
 * runtime + LLM env (fast Rapid-MLX tier, reasoning off). Callers fall back to
 * the per-turn turn_cli.py path if this worker can't be started.
 */

import { spawn, type ChildProcess } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { buildCliPath } from "@/lib/config/binary-detection";
import { voiceRuntime } from "./runtime";
import { voiceLlmEnv } from "./llm-env";
import { voiceOutputDir } from "./tts";

let _proc: ChildProcess | null = null;
let _port: number | null = null;
let _starting: Promise<number> | null = null;

/** Spawn (or reuse) the persistent turn worker; resolves its localhost port. */
export function ensureTurnServer(): Promise<number> {
  if (_proc && _port && _proc.exitCode === null && !_proc.killed) return Promise.resolve(_port);
  if (_starting) return _starting;
  _starting = startServer().finally(() => { _starting = null; });
  return _starting;
}

async function startServer(): Promise<number> {
  const rt = voiceRuntime();
  if (!rt) throw new Error("voice runtime not available — enable Voice in Settings");
  return new Promise<number>((resolve, reject) => {
    const env = { ...process.env, ...voiceLlmEnv(), PATH: buildCliPath() };
    const proc = spawn(rt.python, [join(rt.scriptsDir, "turn_server.py"), "--port", "0"], { cwd: rt.scriptsDir, env });
    let resolved = false;
    const onLine = (d: Buffer) => {
      const m = d.toString().match(/TURN_READY (\d+)/);
      if (m && !resolved) {
        resolved = true;
        _proc = proc;
        _port = parseInt(m[1], 10);
        resolve(_port);
      }
    };
    proc.stdout?.on("data", onLine);
    proc.stderr?.on("data", (d: Buffer) => { const s = d.toString().trimEnd(); if (s) console.error(`[turn] ${s}`); });
    proc.on("exit", () => { _proc = null; _port = null; });
    proc.on("error", (e) => { if (!resolved) { resolved = true; reject(e); } });
    // Generous: first start warms STT + TTS (cold model loads) before TURN_READY.
    setTimeout(() => { if (!resolved) { resolved = true; try { proc.kill(); } catch { /* ignore */ } reject(new Error("turn server start timed out")); } }, 180_000);
  });
}

export interface TurnResult { transcript: string; reply: string; audioBase64: string; escalated: boolean; }

async function postTurn(body: Record<string, unknown>): Promise<TurnResult> {
  const port = await ensureTurnServer();
  const r = await fetch(`http://127.0.0.1:${port}/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await r.json()) as Partial<TurnResult> & { error?: string };
  if (!r.ok) throw new Error(data.error || `turn worker ${r.status}`);
  return { transcript: data.transcript || "", reply: data.reply || "", audioBase64: data.audioBase64 || "", escalated: (data as Record<string, unknown>).escalated === true };
}

/** Relay one push-to-talk turn (recorded audio → server STT) to the warm worker. */
export function relayTurn(audioBase64: string, lang: string): Promise<TurnResult> {
  return postTurn({ audioBase64, lang });
}

/** Relay one turn from an already-transcribed text (on-device STT) — skips STT. */
export function relayTurnText(text: string, lang: string): Promise<TurnResult> {
  return postTurn({ text, lang });
}

/**
 * Re-voice a piece of text with the warm worker's live voice (Kokoro) — used to
 * speak deterministic command/skill/briefing replies in the SAME voice as the
 * conversational reply, instead of the cloned persona. Throws on worker failure
 * so callers can fall back.
 */
export async function relaySynth(text: string, lang: string): Promise<string> {
  const clean = (text ?? "").trim();
  if (!clean) return "";
  const port = await ensureTurnServer();
  const r = await fetch(`http://127.0.0.1:${port}/synth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: clean, lang }),
  });
  const data = (await r.json()) as { audioBase64?: string; error?: string };
  if (!r.ok) throw new Error(data.error || `synth worker ${r.status}`);
  return data.audioBase64 || "";
}

/**
 * Synthesize `text` in the warm live voice (Kokoro) and write it to a .m4a under
 * the voice uploads dir, returning the file path — for callers that attach a file
 * (iMessage voice notes) or read it back. Throws if no audio was produced (e.g.
 * the voice runtime is unavailable) so callers fall back to text.
 */
export async function synthesizeLiveVoice(text: string, lang = "en"): Promise<string> {
  const b64 = await relaySynth(text, lang);
  if (!b64) throw new Error("live voice produced no audio");
  const dir = voiceOutputDir();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `voice-live-${randomBytes(6).toString("hex")}.m4a`);
  writeFileSync(path, Buffer.from(b64, "base64"));
  return path;
}

/** Stop the turn worker (e.g. when the Voice feature is disabled). */
export function stopTurnServer(): void {
  if (_proc && !_proc.killed) { try { _proc.kill(); } catch { /* ignore */ } }
  _proc = null;
  _port = null;
}
