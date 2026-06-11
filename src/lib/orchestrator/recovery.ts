import { getDb } from "@/lib/db";
import { broadcast } from "@/lib/ws/broadcaster";
import { getStaleEntries, unregisterPid } from "./pid-registry";

export async function recoverOrphanedTasks() {
  // Clear stale PID registry entries (processes that no longer exist)
  const stale = getStaleEntries();
  for (const entry of stale) {
    console.log(`[recovery] Stale PID ${entry.pid} for task ${entry.taskId}`);
    unregisterPid(entry.pid);
  }

  const db = getDb();

  // Requeue orphaned in_progress/assigned tasks back to backlog.
  // The server restarted; the task didn't fail — it just lost its process.
  // Directive-owned tasks resume via the run's journal entry, not here.
  const result = db.prepare(`
    UPDATE tasks
    SET status = 'backlog',
        error = NULL,
        agentPid = NULL,
        startedAt = NULL,
        completedAt = NULL,
        logs = '[]',
        updatedAt = datetime('now')
    WHERE status IN ('in_progress', 'assigned')
      AND executor = 'agent'
  `).run();

  if (result.changes > 0) {
    console.log(`[recovery] Requeued ${result.changes} orphaned task(s) to backlog`);
    broadcast({ type: "tasks:recovered", count: result.changes });
  }
}
