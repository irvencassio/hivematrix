/**
 * Script-skill execution — deterministic: run the skill's script verbatim through
 * its interpreter, no model in the loop, same result every time. Runs in the
 * BACKGROUND (releases/builds take minutes), streaming stdout+stderr to a log;
 * status is read back from the log's exit marker. Code execution, so it ONLY runs
 * TRUSTED skills (an imported/untrusted script is refused).
 */

import { spawn } from "child_process";
import { writeFileSync, mkdirSync, readFileSync, existsSync, openSync } from "fs";
import { randomBytes } from "crypto";
import { homedir } from "os";
import { join } from "path";
import type { Skill } from "./contracts";

function runsDir(): string {
  const d = join(homedir(), ".hivematrix", "skill-runs");
  mkdirSync(d, { recursive: true });
  return d;
}

export interface ScriptRunHandle { runId: string; logPath: string; pid: number | null; }
export interface RunScriptResult { ok: boolean; error?: string; run?: ScriptRunHandle; }
export interface RunScriptOptions { cwd?: string; runId?: string; }

export function runScriptSkill(skill: Skill, input: string, opts: RunScriptOptions = {}): RunScriptResult {
  if (skill.kind !== "script") return { ok: false, error: "not a script skill" };
  if (!skill.trusted) return { ok: false, error: "untrusted script skill — Trust it before running code" };

  const runId = opts.runId ?? `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const dir = runsDir();
  const scriptPath = join(dir, `${runId}.script`);
  const logPath = join(dir, `${runId}.log`);
  try {
    writeFileSync(scriptPath, skill.body);
    const out = openSync(logPath, "a");
    // Wrap so the CHILD writes the exit marker — robust even if the daemon restarts
    // mid-run. The interpreter runs the script; then the exit code is appended.
    const wrapped = `${skill.interpreter} ${JSON.stringify(scriptPath)}; echo "[exit $?]" >> ${JSON.stringify(logPath)}`;
    const child = spawn("bash", ["-c", wrapped], {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, SKILL_INPUT: input, HIVE_SKILL_RUN: runId },
      stdio: ["ignore", out, out],
      detached: true,
    });
    child.unref();
    return { ok: true, run: { runId, logPath, pid: child.pid ?? null } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface ScriptRunStatus {
  runId: string;
  status: "running" | "done";
  exitCode: number | null;
  log: string;
}

/** Read a run's status from its log (exit marker = done). Null if unknown id. */
export function getScriptRun(runId: string): ScriptRunStatus | null {
  if (!/^[\w.-]{1,64}$/.test(runId)) return null;
  const logPath = join(runsDir(), `${runId}.log`);
  if (!existsSync(logPath)) return null;
  let log = "";
  try { log = readFileSync(logPath, "utf-8"); } catch { /* still null below */ }
  const m = log.match(/\n?\[exit (-?\d+)\]\s*$/);
  return {
    runId,
    status: m ? "done" : "running",
    exitCode: m ? parseInt(m[1], 10) : null,
    log: log.slice(-8_000),
  };
}
