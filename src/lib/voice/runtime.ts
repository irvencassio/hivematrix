/**
 * Voice sidecar runtime resolver (#4c). Executing a sidecar script needs two
 * things that live in DIFFERENT places once the app is shipped:
 *
 *   • the .py scripts — bundled read-only inside the signed .app at build time
 *     (Resources/daemon/voice-sidecar/), or sitting in ./voice-sidecar in a dev
 *     checkout;
 *   • the Python interpreter — the venv built on first enable into the writable
 *     ~/.hivematrix/voice-runtime (see provision.ts), or the dev sidecar's own
 *     ./voice-sidecar/.venv.
 *
 * In a dev checkout both happen to sit together under ./voice-sidecar, so the
 * old single `sidecarDir()` worked. In the shipped app they don't, so callers
 * resolve the two independently through here. Python adds a script's OWN
 * directory to sys.path (not the cwd), so the sibling-module imports inside the
 * scripts work no matter which interpreter runs them, as long as the whole
 * voice-sidecar/*.py set is bundled together.
 */

import { existsSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { voiceRuntimeDir } from "./provision";

/** Directory of the running daemon bundle (…/Resources/daemon in the .app), or "". */
function bundledDaemonDir(): string {
  return process.argv[1] ? dirname(resolve(process.argv[1])) : "";
}

/**
 * Directory holding the sidecar .py scripts. Probed by the presence of
 * `synth_cli.py` (every sibling module is bundled alongside it). Order: env
 * override → bundled-in-app → dev checkout → ~/hivematrix checkout.
 */
export function voiceScriptsDir(): string | null {
  const bundled = bundledDaemonDir();
  const candidates = [
    process.env.HIVE_VOICE_SIDECAR,
    bundled ? join(bundled, "voice-sidecar") : "", // shipped: Resources/daemon/voice-sidecar
    join(process.cwd(), "voice-sidecar"), // dev checkout
    join(homedir(), "hivematrix", "voice-sidecar"),
  ].filter((d): d is string => !!d);
  for (const d of candidates) if (existsSync(join(d, "synth_cli.py"))) return d;
  return null;
}

/**
 * Python interpreter that runs the sidecar scripts. Order: env override →
 * provisioned runtime (shipped app, ~/.hivematrix) → dev sidecar venv.
 */
export function voicePython(): string | null {
  const candidates = [
    process.env.HIVE_VOICE_PYTHON,
    join(voiceRuntimeDir(), ".venv", "bin", "python"), // provisioned (shipped app)
    join(process.cwd(), "voice-sidecar", ".venv", "bin", "python"), // dev checkout
    join(homedir(), "hivematrix", "voice-sidecar", ".venv", "bin", "python"),
  ].filter((p): p is string => !!p);
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

/** Resolved interpreter + scripts dir, or null when either piece is missing. */
export function voiceRuntime(): { python: string; scriptsDir: string } | null {
  const python = voicePython();
  const scriptsDir = voiceScriptsDir();
  return python && scriptsDir ? { python, scriptsDir } : null;
}
