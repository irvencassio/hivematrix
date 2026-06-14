/**
 * Record a task's completion to the audit log, including a best-effort diff stat
 * (git diff --stat) so the trail shows WHAT changed, not just what was asked.
 * The diff capture is injectable for tests and fails soft (non-git dirs return null).
 */

import { exec } from "child_process";
import { promisify } from "util";
import { recordAudit } from "./audit";

const execAsync = promisify(exec);

export async function captureDiffStat(projectPath: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync("git diff --stat HEAD 2>/dev/null | tail -n 40", {
      cwd: projectPath, timeout: 8_000, maxBuffer: 1024 * 1024, killSignal: "SIGKILL",
    });
    const s = stdout.trim();
    return s || null;
  } catch {
    return null;
  }
}

export interface TaskAuditInput {
  taskId: string;
  agentType?: string;
  model?: string;
  project?: string;
  prompt?: string;
  summary?: string;
  status?: string;
  filesChanged?: string[];
  turns?: number;
  projectPath?: string;
}

export async function recordTaskAudit(
  input: TaskAuditInput,
  opts: { captureDiff?: (p: string) => Promise<string | null> } = {},
): Promise<void> {
  let diffStat: string | undefined;
  if (input.projectPath) {
    const cap = opts.captureDiff ?? captureDiffStat;
    diffStat = (await cap(input.projectPath)) ?? undefined;
  }
  recordAudit({
    event: "task_completed",
    ts: "",
    taskId: input.taskId,
    agentType: input.agentType,
    model: input.model,
    project: input.project,
    prompt: input.prompt,
    summary: input.summary,
    status: input.status,
    filesChanged: input.filesChanged,
    diffStat,
    turns: input.turns,
  });
}
