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
