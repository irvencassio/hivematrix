/**
 * Voice/video runtime provisioning (#4b). When a capable user enables the
 * feature, we build its Python runtime automatically: create a venv under
 * ~/.hivematrix (writable, survives app auto-updates), pip-install the MLX wheels
 * (prebuilt — no compiler needed), and prefetch the models. The base interpreter
 * is the standalone Python bundled in the signed .app (#4c); in a dev checkout it
 * falls back to system `python3`.
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { buildCliPath } from "@/lib/config/binary-detection";

/** Directory of the running daemon bundle (…/Resources/daemon in the .app), or "". */
function bundledDaemonDir(): string {
  return process.argv[1] ? dirname(resolve(process.argv[1])) : "";
}

/** Base Python for provisioning: env override → bundled (app) → system python3. */
export function provisioningPython(): string {
  if (process.env.HIVE_PYTHON && existsSync(process.env.HIVE_PYTHON)) return process.env.HIVE_PYTHON;
  const bundled = bundledDaemonDir();
  const candidates = [
    bundled ? join(bundled, "python", "bin", "python3") : "", // shipped: Resources/daemon/python
    join(process.cwd(), "dist", "daemon", "python", "bin", "python3"), // build output
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  return "python3";
}

/** The sidecar SOURCE (.py + requirements), independent of any venv. */
export function sidecarSourceDir(): string | null {
  const bundled = bundledDaemonDir();
  const candidates = [
    process.env.HIVE_VOICE_SIDECAR,
    bundled ? join(bundled, "voice-sidecar") : "", // shipped: Resources/daemon/voice-sidecar
    join(process.cwd(), "voice-sidecar"),
    join(homedir(), "hivematrix", "voice-sidecar"),
  ].filter((d): d is string => !!d);
  for (const d of candidates) if (existsSync(join(d, "requirements.txt"))) return d;
  return null;
}

export function voiceRuntimeDir(): string { return join(homedir(), ".hivematrix", "voice-runtime"); }
function venvPython(): string { return join(voiceRuntimeDir(), ".venv", "bin", "python"); }
function markerPath(): string { return join(voiceRuntimeDir(), ".provisioned"); }

export function voiceRuntimeReady(): boolean {
  return existsSync(venvPython()) && existsSync(markerPath());
}

export type ProvisionState = "idle" | "running" | "ready" | "error";
let _state: ProvisionState = "idle";
let _log: string[] = [];

export function provisionStatus(): { state: ProvisionState; log: string[] } {
  return { state: voiceRuntimeReady() && _state !== "running" ? "ready" : _state, log: _log.slice(-30) };
}

function step(cmd: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve) => {
    _log.push(`$ ${cmd.split("/").pop()} ${args.join(" ")}`);
    const c = spawn(cmd, args, { cwd, env: { ...process.env, PATH: buildCliPath() } });
    const onData = (d: Buffer) => { const s = d.toString().trimEnd(); if (s) _log.push(s); };
    c.stdout?.on("data", onData);
    c.stderr?.on("data", onData);
    c.on("error", () => resolve(1));
    c.on("exit", (code) => resolve(code ?? 1));
  });
}

/** Build the runtime: venv → pip install → prefetch models. Idempotent-ish. */
export async function provisionVoiceRuntime(): Promise<{ ok: boolean }> {
  if (_state === "running") return { ok: false };
  const src = sidecarSourceDir();
  if (!src) { _state = "error"; _log = ["voice-sidecar source not found"]; return { ok: false }; }

  _state = "running"; _log = ["Setting up the voice runtime…"];
  const dir = voiceRuntimeDir();
  mkdirSync(dir, { recursive: true });
  const venvDir = join(dir, ".venv");

  if (await step(provisioningPython(), ["-m", "venv", venvDir], src) !== 0) { _state = "error"; return { ok: false }; }
  if (await step(join(venvDir, "bin", "pip"), ["install", "--quiet", "-r", join(src, "requirements.txt")], src) !== 0) { _state = "error"; return { ok: false }; }
  await step(join(venvDir, "bin", "python"), [join(src, "prefetch.py")], src); // model download (best-effort)

  writeFileSync(markerPath(), new Date().toISOString());
  _state = "ready";
  _log.push("✅ Voice runtime ready");
  return { ok: true };
}
