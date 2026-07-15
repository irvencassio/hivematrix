/**
 * Per-task git worktree isolation — flag-gated, default OFF (see
 * taskWorktreesEnabled()). When enabled, a task can run in its own
 * `.hive-worktrees/<taskId>` git worktree + `hive/task-<taskId>` branch
 * instead of the shared repo working tree, so its file edits and commits
 * don't land directly on the checked-out branch (usually main) or collide
 * with whatever else is touching the shared tree.
 *
 * Every exported function here is best-effort: none of them throw. A
 * worktree failure must fall back to today's shared-tree behavior, never
 * crash task spawn or cleanup.
 */

import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { isFeatureEnabled } from "@/lib/config/features";

const GIT_STDIO: ["ignore", "pipe", "pipe"] = ["ignore", "pipe", "pipe"];

/**
 * True only if explicitly opted in via env `HIVEMATRIX_TASK_WORKTREES=1` or
 * config.json `features.taskWorktrees === true` (same loader as every other
 * feature flag — see src/lib/config/features.ts). Default false. Never
 * throws — a config read failure is treated as "off".
 */
export function taskWorktreesEnabled(): boolean {
  try {
    if (process.env.HIVEMATRIX_TASK_WORKTREES === "1") return true;
    return isFeatureEnabled("taskWorktrees");
  } catch {
    return false;
  }
}

function isGitRepo(repoPath: string): boolean {
  try {
    execFileSync("git", ["-C", repoPath, "rev-parse", "--git-dir"], { stdio: GIT_STDIO });
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates (or reuses) an isolated worktree + branch for a task. Returns
 * `{ dir, branch }` on success, `null` on any failure — including
 * `repoPath` not being a git repo at all.
 *
 * Branch name is `hive/task-<taskId>`. If that branch (or the target dir)
 * is already taken — e.g. a retried run of the same task — this falls back
 * to attaching the worktree to the existing branch, then to a numeric
 * suffix (`hive/task-<taskId>-2`, `-3`, …) so a create call never silently
 * overwrites another run's worktree.
 */
export function createTaskWorktree(repoPath: string, taskId: string): { dir: string; branch: string } | null {
  try {
    if (!repoPath || !repoPath.trim() || !taskId || !taskId.trim()) return null;
    if (!isGitRepo(repoPath)) return null;

    const worktreesRoot = join(repoPath, ".hive-worktrees");

    for (let attempt = 0; attempt < 20; attempt++) {
      const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
      const branch = `hive/task-${taskId}${suffix}`;
      const dir = join(worktreesRoot, `${taskId}${suffix}`);
      if (existsSync(dir)) continue; // dir already taken — try the next suffix

      // Try creating a fresh branch first…
      try {
        execFileSync("git", ["-C", repoPath, "worktree", "add", dir, "-b", branch], { stdio: GIT_STDIO });
        return { dir, branch };
      } catch {
        // …most likely because the branch already exists. Attach the
        // worktree to the existing branch instead of failing outright.
        try {
          execFileSync("git", ["-C", repoPath, "worktree", "add", dir, branch], { stdio: GIT_STDIO });
          return { dir, branch };
        } catch {
          // Branch exists but is checked out elsewhere, or some other
          // failure — fall through and try the next numeric suffix.
          continue;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Best-effort removal of a worktree directory we created. Never throws.
 * Deliberately does NOT delete the branch — it holds the task's commits,
 * and the operator/agent may still want to inspect or merge them.
 */
export function removeTaskWorktree(repoPath: string, dir: string): void {
  try {
    execFileSync("git", ["-C", repoPath, "worktree", "remove", "--force", dir], { stdio: GIT_STDIO });
  } catch {
    // Best-effort only — leave it for manual cleanup rather than throw.
  }
}

/** True if `dir` is (or is under) a worktree this module created. */
export function isTaskWorktreeDir(dir: string): boolean {
  return typeof dir === "string" && dir.includes("/.hive-worktrees/");
}
