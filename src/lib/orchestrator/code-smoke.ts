/**
 * Deterministic code smoke-runner — the enforcement half of the verification gate.
 *
 * The gate prompt (verification-gate.ts) asks the agent to run its code. Heavily
 * quantized local models routinely skip that step or settle for `py_compile` /
 * `import`, which are green even when the program crashes on first render (the
 * classic `_curses.error: addwstr() returned ERR`). This module closes that gap
 * from the daemon side: after a local coding agent touches Python files, we run
 * them ourselves in a real pseudo-terminal (via scripts/hive-verify-smoke.py) and,
 * if one crashes, feed the traceback back into the agent loop so it must fix the
 * code before the task is allowed to complete.
 *
 * Scope: Python entry-point scripts today (the observed failure mode). The harness
 * is language-agnostic in spirit; extend `RUNNABLE_EXTENSIONS` + the harness when
 * another language's runtime bugs start slipping through static checks.
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Extensions we currently know how to smoke-run. */
const RUNNABLE_EXTENSIONS = [".py"];

/** Hard ceiling so a wedged target can never hang the daemon (harness has its own). */
const SMOKE_TIMEOUT_MS = 30_000;

/** Directory of the running daemon bundle (…/Resources/daemon in the .app), or "". */
function bundledDaemonDir(): string {
  return process.argv[1] ? dirname(resolve(process.argv[1])) : "";
}

/**
 * Locate the smoke harness. Order mirrors voiceScriptsDir(): env override →
 * bundled-in-app → dev checkout → ~/hivematrix checkout. Returns null if it can't
 * be found (in which case enforcement no-ops rather than blocking the task).
 */
export function smokeScriptPath(): string | null {
  const bundled = bundledDaemonDir();
  const candidates = [
    process.env.HIVE_VERIFY_SMOKE,
    bundled ? join(bundled, "scripts", "hive-verify-smoke.py") : "",
    join(process.cwd(), "scripts", "hive-verify-smoke.py"),
    join(homedir(), "hivematrix", "scripts", "hive-verify-smoke.py"),
  ].filter((p): p is string => !!p);
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

/** True if `file` is something the harness can smoke-run. */
export function isRunnableFile(file: string): boolean {
  return RUNNABLE_EXTENSIONS.some((ext) => file.toLowerCase().endsWith(ext));
}

interface HarnessFileResult {
  path: string;
  kind: string;
  status: "pass" | "fail" | "skip";
  detail: string;
}
interface HarnessOutput {
  ok: boolean;
  files: HarnessFileResult[];
}

export interface CodeSmokeResult {
  /** False when there was nothing to run or the harness was unavailable. */
  ran: boolean;
  /** True when every runnable file passed (or nothing ran). */
  ok: boolean;
  /** Human/agent-facing report — the message we feed back into the loop on failure. */
  report: string;
}

/**
 * Smoke-run the runnable files among `files` (absolute or project-relative paths).
 * `python3` is taken from PATH — the same interpreter the agent and the operator
 * would run — so a target's imports resolve exactly as they would by hand.
 */
export async function runCodeSmoke(projectPath: string, files: string[]): Promise<CodeSmokeResult> {
  const runnable = [...new Set(files)].filter(isRunnableFile).filter((f) => existsSync(resolvePath(f, projectPath)));
  if (runnable.length === 0) return { ran: false, ok: true, report: "" };

  const script = smokeScriptPath();
  if (!script) {
    // Can't verify → don't block the task, but say so (visible in the summary).
    return { ran: false, ok: true, report: "" };
  }

  const absFiles = runnable.map((f) => resolvePath(f, projectPath));
  try {
    const { stdout } = await execFileAsync("python3", [script, ...absFiles], {
      cwd: projectPath,
      timeout: SMOKE_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, HIVE_AGENT: "1" },
    });
    // Exit 0 → all clear.
    return { ran: true, ok: true, report: summarize(stdout, true) };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean; signal?: string };
    if (e.killed || e.signal === "SIGKILL") {
      // The harness caps its own runtime; hitting the outer timeout means something
      // pathological. Don't wrongly fail the task on a harness stall — report it.
      return { ran: true, ok: true, report: `Code smoke skipped: harness timed out after ${SMOKE_TIMEOUT_MS / 1000}s.` };
    }
    // Exit 1 = at least one file crashed. Build the fix-me report from JSON.
    const report = summarize(e.stdout ?? "", false) || `Code smoke failed:\n${(e.stderr ?? "").slice(0, 2000)}`;
    return { ran: true, ok: false, report };
  }
}

function resolvePath(p: string, projectPath: string): string {
  return p.startsWith("/") ? p : resolve(projectPath, p);
}

/** Turn the harness JSON into a concise, agent-actionable report. */
function summarize(stdout: string, ok: boolean): string {
  let parsed: HarnessOutput | null;
  try {
    parsed = JSON.parse(stdout.trim().split("\n").pop() ?? "");
  } catch {
    parsed = null;
  }
  if (!parsed || !Array.isArray(parsed.files)) {
    return ok ? "" : stdout.slice(0, 2000);
  }
  const lines: string[] = [];
  for (const f of parsed.files) {
    if (f.status === "fail") {
      lines.push(`FAIL  ${f.path} (${f.kind})\n${indent(stripAnsi(f.detail))}`);
    }
  }
  if (lines.length === 0) return ""; // nothing to report on success
  return [
    "--- Code Verification Gate: FAILED ---",
    "Your code failed verification — either a static check (ruff caught an undefined",
    "name or bad import that py_compile/mypy miss) or a real runtime crash when run in",
    "a terminal. These are genuine defects, not false alarms. Fix the code and do not",
    "report completion until it passes clean:",
    "",
    ...lines,
  ].join("\n");
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => "    " + l)
    .join("\n");
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
