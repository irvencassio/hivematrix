/**
 * Atomic single-flight guard for directive dispatch.
 *
 * Prevents concurrent daemon processes (e.g., during a daemon restart race) from
 * both running the same directive at the same time. Uses the same two-phase
 * durable idempotency lock pattern as message_send_cap:
 * 1. CHECK: Query the table to see if this (directiveId, runStartedAt) is already claimed
 * 2. CLAIM: Atomically INSERT with UNIQUE constraint to claim the slot
 * 3. MARK: After successful run creation, UPDATE to record the created runId
 *
 * The UNIQUE constraint on (directiveId, runStartedAt) is the atomic CAS primitive
 * that prevents the race: only the first process's INSERT succeeds; concurrent
 * attempts fail with UNIQUE violation, even under daemon restarts and multi-process
 * scenarios. The runStartedAt timestamp ensures each directive run gets its own slot
 * (multiple runs of the same directive at different times each get a chance to execute).
 *
 * Design rationale:
 * - better-sqlite3 is synchronous (no async I/O races within a process)
 * - SQLite UNIQUE constraint is enforced at the database file level, not per-connection
 * - Even with multiple processes/connections, only one INSERT on (directiveId, runStartedAt) succeeds
 * - The cap persists across daemon restarts (slot remains in DB)
 * - The cap blocks all concurrent paths: concurrent scheduler ticks, daemon restart races
 */

import { getDb, generateId } from "@/lib/db";

const TABLE = "directive_dispatch_cap";

interface DirectiveDispatchCapRecord {
  _id: string;
  directiveId: string;
  runStartedAt: string;
  reservedAt: string;
  createdRunId?: string;
}

/**
 * Check if a directive run at this time is already claimed/created.
 * Returns true if this (directiveId, runStartedAt) has a reservation (claimed or created).
 */
export function isRunClaimed(directiveId: string, runStartedAt: string): boolean {
  const record = getDb().prepare(
    `SELECT _id FROM ${TABLE} WHERE directiveId = ? AND runStartedAt = ?`,
  ).get(directiveId, runStartedAt) as { _id?: string } | undefined;
  return !!record?._id;
}

/**
 * Atomically reserve the run slot for this (directiveId, runStartedAt) pair.
 * Returns true if reservation succeeded (this process claimed the slot).
 * Returns false if slot is already claimed (another process, a prior attempt, or a daemon restart).
 *
 * Uses SQLite's UNIQUE constraint on (directiveId, runStartedAt) as the atomic CAS primitive.
 * Even with concurrent processes, only one INSERT succeeds; others fail with UNIQUE violation.
 *
 * CRITICAL: This is DURABLE. If this function returns true, the slot is persisted in the
 * database. On daemon restart, the slot remains claimed, blocking re-runs even after the
 * daemon comes back up. This is intentional: each directive at each scheduled time gets at
 * most one run, even across multiple daemon lifetimes.
 */
export function attemptReserveRun(directiveId: string, runStartedAt: string): boolean {
  try {
    const id = generateId();
    const db = getDb();

    // INSERT with UNIQUE constraint: atomic at the database file level.
    // If another process beat us here (even concurrently), SQLite will reject our INSERT
    // with a UNIQUE constraint violation.
    db.prepare(
      `INSERT INTO ${TABLE} (_id, directiveId, runStartedAt, reservedAt)
       VALUES (?, ?, ?, datetime('now'))`,
    ).run(id, directiveId, runStartedAt);

    return true;
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string };

    // better-sqlite3 wraps SQLite errors in Error objects with:
    // - code: usually includes "CONSTRAINT" for constraint violations
    // - message: includes human-readable text like "UNIQUE constraint failed: ..."
    const errorStr = String(error.message || error.code || err).toUpperCase();
    const isConstraintViolation = errorStr.includes("UNIQUE");

    if (isConstraintViolation) {
      // Slot is already claimed (by another process, a prior attempt, or a daemon restart).
      // This is the expected path when the cap is enforced correctly.
      return false;
    }

    // Unexpected error (not a UNIQUE violation). Re-throw with context.
    const msg = error.message || String(err);
    throw new Error(
      `attemptReserveRun failed for directiveId="${directiveId}" runStartedAt="${runStartedAt}": ${msg}`,
      { cause: err },
    );
  }
}

/**
 * Mark a reservation as run-created, storing the created runId.
 * Call after successful run creation via createRun(directiveId).
 * If the reservation doesn't exist, do nothing (idempotent).
 */
export function markRunCreated(directiveId: string, runStartedAt: string, createdRunId: string): void {
  getDb().prepare(
    `UPDATE ${TABLE} SET createdRunId = ?
     WHERE directiveId = ? AND runStartedAt = ?`,
  ).run(createdRunId, directiveId, runStartedAt);
}

/**
 * Get a previously created runId for this (directiveId, runStartedAt) pair.
 * Returns the runId if the run was already created in this slot, null otherwise.
 * Used for reconciliation when a process recovers after a crash.
 */
export function getCreatedRunId(directiveId: string, runStartedAt: string): string | null {
  const record = getDb().prepare(
    `SELECT createdRunId FROM ${TABLE}
     WHERE directiveId = ? AND runStartedAt = ?`,
  ).get(directiveId, runStartedAt) as { createdRunId?: string | null } | undefined;
  return record?.createdRunId ?? null;
}

/** Clear old records (older than N days, default 30) for cleanup. */
export function pruneDispatchCap(olderThanDays = 30): number {
  const result = getDb().prepare(
    `DELETE FROM ${TABLE}
     WHERE datetime(reservedAt) < datetime('now', '-' || ? || ' days')`,
  ).run(olderThanDays) as { changes: number };
  return result.changes ?? 0;
}

/**
 * Get all dispatch cap records for a directive (for audit/debugging).
 */
export function getDirectiveDispatchRecords(directiveId: string): DirectiveDispatchCapRecord[] {
  return getDb().prepare(
    `SELECT _id, directiveId, runStartedAt, reservedAt, createdRunId
     FROM ${TABLE}
     WHERE directiveId = ?
     ORDER BY runStartedAt DESC`,
  ).all(directiveId) as DirectiveDispatchCapRecord[];
}
