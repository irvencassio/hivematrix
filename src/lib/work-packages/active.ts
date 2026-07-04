/**
 * Active same-project work lookup for Task Intake collision detection. "Active"
 * = a task in flight (assigned / in_progress) in the same repo working tree.
 * Returns only non-secret metadata (id, title, worktree name).
 */

import { getDb } from "@/lib/db";
import type { IntakeActiveTask } from "@/lib/intake/classify";

const ACTIVE_STATUSES = ["assigned", "in_progress"];

export function activeSameProjectTasks(projectPath: string, excludeTaskId?: string): IntakeActiveTask[] {
  if (!projectPath) return [];
  const db = getDb();
  const placeholders = ACTIVE_STATUSES.map(() => "?").join(", ");
  const rows = db.prepare(
    `SELECT _id, title, worktreeName FROM tasks WHERE projectPath = ? AND status IN (${placeholders})`,
  ).all(projectPath, ...ACTIVE_STATUSES) as Array<{ _id: string; title: string; worktreeName: string | null }>;
  return rows
    .filter((r) => r._id !== excludeTaskId)
    .map((r) => ({ taskId: r._id, title: r.title, worktreeName: r.worktreeName }));
}

/**
 * True if any of the given task ids is still in flight (assigned / in_progress).
 * Used to decide whether a Flight's same-project collision hold still applies:
 * once every task that triggered the hold is terminal, the hold can be released.
 */
export function anyTaskActive(taskIds: string[]): boolean {
  if (taskIds.length === 0) return false;
  const db = getDb();
  const idPlaceholders = taskIds.map(() => "?").join(", ");
  const statusPlaceholders = ACTIVE_STATUSES.map(() => "?").join(", ");
  const row = db.prepare(
    `SELECT 1 FROM tasks WHERE _id IN (${idPlaceholders}) AND status IN (${statusPlaceholders}) LIMIT 1`,
  ).get(...taskIds, ...ACTIVE_STATUSES);
  return !!row;
}
