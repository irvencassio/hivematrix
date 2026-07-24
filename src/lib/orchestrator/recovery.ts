import { getDb } from "@/lib/db";
import { broadcast } from "@/lib/ws/broadcaster";
import { getStaleEntries, unregisterPid, isProcessAlive } from "./pid-registry";
import { describeInterruption, isInterruptionError } from "./shutdown-checkpoint";

export interface RecoveryOutcome {
  /** Tasks requeued with a session to resume from. */
  resumed: number;
  /** Tasks requeued with no session available — they restart from the top. */
  restarted: number;
  /** Tasks still owned by a live worker process; left alone. */
  stillRunning: number;
}

/**
 * Boot-time recovery for tasks that were in flight when the daemon last stopped.
 *
 * Previously this blanked every orphan (`error = NULL`, `logs = '[]'`) and
 * requeued it to backlog. Two problems with that:
 *
 *  1. It discarded `sessionId`, so a task that had been running for an hour
 *     restarted from zero instead of resuming. Long-horizon work (the
 *     self-improvement directive loop above all) could therefore never make
 *     progress across an update.
 *  2. It erased the reason, so the operator saw a task silently back in the
 *     backlog with no record that it had been killed.
 *
 * Now: promote `sessionId` -> `resumeSessionId` so the scheduler resumes the
 * run, and keep an explicit `Interrupted:` error naming the cause. A row that
 * already carries an `Interrupted:` marker was checkpointed by a clean
 * teardown; a row without one means the daemon died without checkpointing
 * (crash / OOM / forced kill), and is labelled as such rather than being given
 * a falsely tidy story.
 *
 * A task whose `agentPid` is still alive is NOT touched — that is a worker that
 * outlived us, and requeueing it would double-run the task.
 */
export async function recoverOrphanedTasks(): Promise<RecoveryOutcome> {
  // Clear stale PID registry entries (processes that no longer exist)
  const stale = getStaleEntries();
  for (const entry of stale) {
    console.log(`[recovery] Stale PID ${entry.pid} for task ${entry.taskId}`);
    unregisterPid(entry.pid);
  }

  const db = getDb();

  const orphans = db.prepare(`
    SELECT _id, agentPid, sessionId, resumeSessionId, error
    FROM tasks
    WHERE status IN ('in_progress', 'assigned') AND executor = 'agent'
  `).all() as {
    _id: string;
    agentPid: number | null;
    sessionId: string | null;
    resumeSessionId: string | null;
    error: string | null;
  }[];

  const outcome: RecoveryOutcome = { resumed: 0, restarted: 0, stillRunning: 0 };
  if (orphans.length === 0) return outcome;

  const requeue = db.prepare(`
    UPDATE tasks
    SET status = 'backlog',
        error = ?,
        resumeSessionId = ?,
        agentPid = NULL,
        startedAt = NULL,
        completedAt = NULL,
        updatedAt = datetime('now')
    WHERE _id = ?
  `);

  for (const task of orphans) {
    // A live agentPid means the worker survived whatever stopped the daemon.
    // Leave it be: the running process still owns this task.
    if (task.agentPid !== null && isProcessAlive(task.agentPid)) {
      outcome.stillRunning++;
      console.log(`[recovery] task ${task._id} still owned by live PID ${task.agentPid} — leaving in place`);
      continue;
    }

    // An `Interrupted:` error means a clean teardown already checkpointed this
    // row and recorded why. Anything else means we died without checkpointing.
    const error = isInterruptionError(task.error)
      ? task.error!
      : describeInterruption("unclean_exit");

    const resumeSessionId = task.resumeSessionId ?? task.sessionId ?? null;
    requeue.run(error, resumeSessionId, task._id);

    if (resumeSessionId) outcome.resumed++;
    else outcome.restarted++;
  }

  const requeued = outcome.resumed + outcome.restarted;
  if (requeued > 0) {
    console.log(
      `[recovery] Requeued ${requeued} interrupted task(s): ${outcome.resumed} will resume their session, ` +
        `${outcome.restarted} restart from the top` +
        (outcome.stillRunning ? `; ${outcome.stillRunning} left running` : ""),
    );
    broadcast({ type: "tasks:recovered", count: requeued });
  }

  return outcome;
}
