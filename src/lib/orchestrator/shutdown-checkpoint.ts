/**
 * Task-worker durability across daemon shutdown / restart / update.
 *
 * WHY THIS EXISTS
 * ---------------
 * Agent workers are spawned with plain `spawn()` (no `detached`), so every
 * agent child inherits the daemon's process group. The daemon runs as a launchd
 * job (`com.hivematrix.daemon`), which makes the daemon the process-group
 * leader for its whole worker tree. Consequently `launchctl kickstart -k`
 * — issued by the updater (`restartViaLaunchd`), by POST /system/restart-daemon
 * and by POST /messagebee/restart-daemon — SIGKILLs the *entire group*, agents
 * included. A plain SIGTERM to the job does the same with SIGTERM (children
 * observed exiting 143 = 128+15).
 *
 * Before this module, that collateral kill was recorded by agent-manager's exit
 * handler as an ordinary agent failure ("Killed by signal: SIGKILL" /
 * "Exited with code: 143"), and startup recovery then blanked the row
 * (`error = NULL`, `logs = '[]'`) and requeued it WITHOUT promoting
 * `sessionId` into `resumeSessionId` — so the task restarted from zero and the
 * evidence of why was gone. Long-running work (the self-improvement directive
 * loop most of all) could never survive an update.
 *
 * The contract here is:
 *   1. Whoever is about to tear the daemon down calls `checkpointInFlightTasks`
 *      FIRST. That write is synchronous and durable (better-sqlite3), so it
 *      survives even an untrappable SIGKILL that lands microseconds later.
 *   2. The checkpoint promotes `sessionId` -> `resumeSessionId` so the task can
 *      be resumed (`claude --resume`) instead of restarted, and stamps an
 *      `Interrupted:` error naming the real cause.
 *   3. `isShuttingDown()` lets the agent exit handler tell "we killed it" apart
 *      from "the agent failed", so a kill is never reported as a task failure.
 *   4. Startup recovery reads the `Interrupted:` marker to tell a clean,
 *      checkpointed teardown apart from a hard crash / OOM (no marker).
 */

import { getDb } from "@/lib/db";

/** Every interruption error text starts with this. Never used for agent-reported failures. */
export const INTERRUPTION_PREFIX = "Interrupted:";

export type InterruptionReason =
  /** SIGTERM/SIGINT to the daemon (app quit, launchctl bootout, operator ctrl-C). */
  | "daemon_shutdown"
  /** Operator-triggered restart (POST /system/restart-daemon, /messagebee/restart-daemon). */
  | "daemon_restart"
  /** Auto-update applied a new bundle and kickstarted the daemon. */
  | "app_update"
  /** Daemon died without checkpointing (hard crash, OOM kill, power loss). */
  | "unclean_exit";

const REASON_TEXT: Record<InterruptionReason, string> = {
  daemon_shutdown: "the daemon was shut down (app quit or system stop) while this task was running",
  daemon_restart: "the daemon was restarted while this task was running",
  app_update: "an app update restarted the daemon while this task was running",
  unclean_exit: "the daemon exited without shutting down cleanly (crash, forced kill, or out-of-memory) while this task was running",
};

let shuttingDown: InterruptionReason | null = null;

/**
 * Declare that a teardown is in progress. Call this BEFORE signalling any
 * worker so `handleExit` attributes the resulting child death to us.
 */
export function beginShutdown(reason: InterruptionReason): void {
  shuttingDown = reason;
}

/** Test-only: clear the module-level teardown flag. */
export function resetShutdownState(): void {
  shuttingDown = null;
}

export function isShuttingDown(): boolean {
  return shuttingDown !== null;
}

export function getShutdownReason(): InterruptionReason | null {
  return shuttingDown;
}

/** Human-readable error text for an interruption. Always `Interrupted:`-prefixed. */
export function describeInterruption(reason: InterruptionReason, detail?: string): string {
  const base = `${INTERRUPTION_PREFIX} ${REASON_TEXT[reason]}.`;
  const tail = " The agent did not fail — its work was cut short and the session is saved for resume.";
  return detail ? `${base} (${detail})${tail}` : `${base}${tail}`;
}

/** True when an error string was written by this module (i.e. we killed it). */
export function isInterruptionError(error: string | null | undefined): boolean {
  return typeof error === "string" && error.startsWith(INTERRUPTION_PREFIX);
}

/**
 * True when a child's exit looks like an externally-delivered kill rather than
 * the agent deciding to exit.
 *
 * - `signal` set at all means the kernel killed it (SIGKILL/SIGTERM/...).
 * - 143 (128+SIGTERM) and 137 (128+SIGKILL) are what a shell-wrapped child
 *   reports when it is signalled but re-exports the signal as an exit code;
 *   both were observed in the failure data.
 */
export function isKilledExit(code: number | null, signal: string | null): boolean {
  if (signal) return true;
  return code === 143 || code === 137;
}

export interface CheckpointResult {
  /** Number of in-flight task rows checkpointed. */
  checkpointed: number;
  /** Ids of the tasks that were checkpointed, for logging. */
  taskIds: string[];
}

/**
 * Durably record every in-flight agent task as interrupted, BEFORE the workers
 * are signalled.
 *
 * Synchronous on purpose: this must be safe to call from a signal handler and
 * must have hit disk before an untrappable SIGKILL arrives. It deliberately
 * leaves `status` alone — startup recovery is what requeues — so that a
 * teardown which is then aborted does not lose the running row.
 */
export function checkpointInFlightTasks(reason: InterruptionReason): CheckpointResult {
  const db = getDb();
  const rows = db.prepare(`
    SELECT _id FROM tasks
    WHERE status IN ('assigned', 'in_progress') AND executor = 'agent'
  `).all() as { _id: string }[];

  if (rows.length === 0) return { checkpointed: 0, taskIds: [] };

  // COALESCE keeps an existing resumeSessionId (a resume that was itself
  // interrupted) rather than clobbering it with a newer sessionId.
  db.prepare(`
    UPDATE tasks
    SET resumeSessionId = COALESCE(resumeSessionId, sessionId),
        error = ?,
        updatedAt = datetime('now')
    WHERE status IN ('assigned', 'in_progress') AND executor = 'agent'
  `).run(describeInterruption(reason));

  return { checkpointed: rows.length, taskIds: rows.map((r) => r._id) };
}
