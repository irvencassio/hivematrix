/**
 * Sandboxed synchronous script-skill runner — the security boundary for running
 * skill scripts IN-TURN, so a chat/voice turn can speak the result back before it
 * ends. This is deliberately NOT run-script.ts: that one runs detached/background
 * (for long builds), streaming to a log and returning immediately. This one
 * spawns the interpreter, awaits stdout/stderr to completion (or timeout), and
 * resolves synchronously with the captured result.
 *
 * The env passed to the child is an ALLOWLIST, never a spread of process.env —
 * that's the actual security boundary. HIVE_* daemon tokens, API keys, and any
 * other operator secret in this process's environment are simply never copied
 * into the child. HOME and TMPDIR are pinned to a fresh per-run scratch
 * directory so `~`-relative reads/writes land there, not in the operator's real
 * home.
 *
 * On darwin, the run is additionally wrapped in `sandbox-exec` with a
 * network-deny profile (`(allow default)` + `(deny network*)`) so a script
 * cannot exfiltrate data or phone home even if it somehow got a stray secret.
 * If sandbox-exec isn't present (non-darwin, or a stripped-down box), we fall
 * back to a plain spawn — still env-scrubbed and cwd-scoped — and flag
 * `sandboxed: false` in both the result and the audit entry so an operator can
 * see an unsandboxed run happened.
 *
 * Untrusted/blocked skills are refused UPSTREAM by the caller (see P1.3) — this
 * module's only job is to run a script safely and report what happened via a
 * `skill:run` audit event.
 */

import { spawn, type SpawnOptions } from "child_process";
import { writeFileSync, mkdtempSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Skill } from "./contracts";
import { applySkillParams } from "./contracts";
import { recordAudit, type AuditEntry } from "@/lib/audit/audit";

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const OUTPUT_CAP_BYTES = 64 * 1024;
const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";

/** Deny all network activity; allow everything else (file I/O is further scoped
 * by the scratch cwd + HOME, and secrets are kept out by the env allowlist). */
const NETWORK_DENY_PROFILE = "(version 1)\n(allow default)\n(deny network*)\n";

export interface SandboxOptions {
  /** Becomes $SKILL_INPUT in the child. */
  input?: string;
  /** Applied to the skill body via applySkillParams before it's written to disk. */
  params?: Record<string, string>;
  /** Default 30s; clamped to [1_000, 120_000]. */
  timeoutMs?: number;
  /** Default: a fresh per-run scratch dir under os.tmpdir(). */
  cwd?: string;
  /** Injectable audit sink; defaults to recordAudit. */
  audit?: (entry: AuditEntry) => void;
  /** Test seam — inject a fake `spawn`. */
  spawnImpl?: typeof spawn;
  /** Test seam for audit timestamps. */
  now?: () => string;
}

export interface SandboxResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** True if run under sandbox-exec network-deny; false if fallback (unsandboxed). */
  sandboxed: boolean;
  durationMs: number;
}

function clampTimeout(ms: number | undefined): number {
  const v = ms ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(v)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, v));
}

/** Defensive detection — never throws, never assumes darwin implies presence. */
function sandboxExecAvailable(): boolean {
  if (process.platform !== "darwin") return false;
  try {
    return existsSync(SANDBOX_EXEC_PATH);
  } catch {
    return false;
  }
}

/**
 * Minimal env allowlist — THIS is the security boundary, not an afterthought.
 * We build a brand-new object rather than spreading process.env so that no
 * HIVE_* token, API key, or other operator secret can leak into the child by
 * accident. Only PATH (to find interpreters/coreutils), a scratch HOME/TMPDIR,
 * locale vars (if set), and SKILL_INPUT are passed through.
 */
function buildEnv(scratchCwd: string, input: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: scratchCwd,
    TMPDIR: scratchCwd,
    SKILL_INPUT: input ?? "",
  };
  if (process.env.LANG) env.LANG = process.env.LANG;
  if (process.env.LC_ALL) env.LC_ALL = process.env.LC_ALL;
  return env;
}

function appendCapped(existing: string, chunk: string): string {
  if (existing.length >= OUTPUT_CAP_BYTES) return existing;
  const next = existing + chunk;
  return next.length > OUTPUT_CAP_BYTES ? next.slice(0, OUTPUT_CAP_BYTES) : next;
}

function safeAudit(
  audit: (entry: AuditEntry) => void,
  skill: Skill,
  status: "ok" | "fail" | "timeout",
  sandboxed: boolean,
  note?: string,
): void {
  try {
    audit({
      ts: "",
      event: "skill:run",
      summary: `skill "${skill.name}" ${status} — ${sandboxed ? "sandboxed" : "UNSANDBOXED FALLBACK"}${note ? ` (${note})` : ""}`,
      status,
    });
  } catch {
    // Auditing must never break a run.
  }
}

export async function runSkillSandboxed(skill: Skill, opts: SandboxOptions = {}): Promise<SandboxResult> {
  const start = Date.now();
  const audit: (entry: AuditEntry) => void =
    opts.audit ?? ((entry) => recordAudit(entry, opts.now ? { now: opts.now } : {}));
  const timeoutMs = clampTimeout(opts.timeoutMs);
  const spawnFn = opts.spawnImpl ?? spawn;

  let scratchCwd: string;
  try {
    scratchCwd = opts.cwd ?? mkdtempSync(join(tmpdir(), "hive-skill-"));
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    safeAudit(audit, skill, "fail", false, "scratch dir creation failed");
    return { ok: false, exitCode: null, stdout: "", stderr: message, timedOut: false, sandboxed: false, durationMs };
  }

  let scriptPath: string;
  try {
    const body = applySkillParams(skill.body, opts.params ?? {});
    scriptPath = join(scratchCwd, "skill-script");
    writeFileSync(scriptPath, body, { mode: 0o700 });
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    safeAudit(audit, skill, "fail", false, "script write failed");
    return { ok: false, exitCode: null, stdout: "", stderr: message, timedOut: false, sandboxed: false, durationMs };
  }

  const env = buildEnv(scratchCwd, opts.input);
  const sandboxed = sandboxExecAvailable();
  const [command, args] = sandboxed
    ? [SANDBOX_EXEC_PATH, ["-p", NETWORK_DENY_PROFILE, skill.interpreter, scriptPath]]
    : [skill.interpreter, [scriptPath]];

  return new Promise<SandboxResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const finish = (result: Omit<SandboxResult, "durationMs">) => {
      if (settled) return;
      settled = true;
      const durationMs = Date.now() - start;
      safeAudit(audit, skill, timedOut ? "timeout" : result.ok ? "ok" : "fail", sandboxed);
      resolve({ ...result, durationMs });
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawnFn(command, args, {
        cwd: scratchCwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      } as SpawnOptions);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      finish({ ok: false, exitCode: null, stdout: "", stderr: message, timedOut: false, sandboxed });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (typeof child.pid === "number") process.kill(-child.pid, "SIGKILL");
      } catch {
        // Process may already be gone; fall through to direct kill below.
      }
      try {
        child.kill("SIGKILL");
      } catch {
        // Best-effort.
      }
    }, timeoutMs);
    // Don't let the timeout itself keep the event loop (or this promise) alive
    // longer than necessary once the child has already settled.
    timer.unref?.();

    child.stdout?.on("data", (d: Buffer) => {
      stdout = appendCapped(stdout, d.toString());
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr = appendCapped(stderr, d.toString());
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      finish({ ok: false, exitCode: null, stdout, stderr: stderr || err.message, timedOut, sandboxed });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const ok = !timedOut && code === 0;
      finish({ ok, exitCode: timedOut ? null : code, stdout, stderr, timedOut, sandboxed });
    });
  });
}
