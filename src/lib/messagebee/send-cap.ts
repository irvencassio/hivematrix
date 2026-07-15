/**
 * Atomic single-delivery guard for iMessage dispatch.
 *
 * Enforces at most one send per (runId, recipient) pair: within a single
 * directive/task run, each recipient is contacted exactly once. A run that
 * legitimately texts several people still reaches all of them (each is its own
 * key), but any retry path — failed-task re-dispatch, an internal retry loop, a
 * daemon restart, or two concurrent daemon processes — can never deliver the
 * same message to the same person twice.
 *
 * Two-phase durable idempotency lock:
 * 1. CHECK: is (runId, recipient) already reserved/sent?
 * 2. CLAIM: atomically INSERT, relying on the UNIQUE(runId, recipient) index
 *           to reject a losing racer at the database-file level.
 * 3. MARK:  after a successful send, UPDATE sentAt.
 *
 * Design rationale:
 * - better-sqlite3 is synchronous (no async I/O races within a process).
 * - The SQLite UNIQUE constraint is enforced at the database-file level, not
 *   per-connection, so even across processes only one INSERT on a given
 *   (runId, recipient) succeeds; the others fail with a UNIQUE violation.
 * - The reservation is durable: it survives daemon restarts, so a re-dispatch
 *   after a restart still finds the slot claimed and refuses the duplicate.
 */

import { getDb, generateId } from "@/lib/db";

const TABLE = "message_send_cap";

interface SendCapRecord {
  _id: string;
  runId: string;
  recipient: string;
  sendId: string;
  reservedAt: string;
  sentAt?: string;
}

/**
 * Check if a slot is already claimed/sent (idempotent check for reconciliation).
 * Returns true if this (runId, recipient) has a reservation (reserved or sent).
 */
export function isSlotClaimed(runId: string, recipient = ""): boolean {
  const record = getDb().prepare(
    `SELECT _id FROM ${TABLE} WHERE runId = ? AND recipient = ?`,
  ).get(runId, recipient) as { _id?: string } | undefined;
  return !!record?._id;
}

/**
 * Atomically reserve the send slot for this (runId, recipient) pair.
 * Returns true if the reservation succeeded (this process claimed the slot).
 * Returns false if the slot is already claimed (another process, a prior
 * attempt, or a daemon restart).
 *
 * Uses SQLite's UNIQUE(runId, recipient) index as the atomic CAS primitive.
 * Even with concurrent processes, only one INSERT succeeds; the others fail
 * with a UNIQUE constraint violation.
 *
 * @param runId The directive/task run ID
 * @param recipient The recipient handle — part of the idempotency key
 * @returns true if this process successfully claimed the slot
 */
export function attemptReserve(runId: string, recipient = ""): boolean {
  try {
    const id = generateId();
    const db = getDb();

    // INSERT with UNIQUE(runId, recipient): atomic at the database-file level.
    // If another process beat us here (even concurrently), SQLite rejects our
    // INSERT with a UNIQUE constraint violation.
    db.prepare(
      `INSERT INTO ${TABLE} (_id, runId, recipient, sendId, reservedAt)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    ).run(id, runId, recipient, id);

    return true;
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string };

    // better-sqlite3 wraps SQLite errors with a `message` like
    // "UNIQUE constraint failed: ..." and a `code` including "CONSTRAINT".
    const errorStr = String(error.message || error.code || err).toUpperCase();
    const isConstraintViolation = errorStr.includes("UNIQUE");

    if (isConstraintViolation) {
      // Slot already claimed (another process, a prior attempt, or a restart).
      // This is the expected path when the cap is doing its job.
      return false;
    }

    // Unexpected error (not a UNIQUE violation). Re-throw with context.
    const msg = error.message || String(err);
    throw new Error(
      `attemptReserve failed for runId="${runId}" recipient="${recipient}": ${msg}`,
      { cause: err },
    );
  }
}

/**
 * Mark a reservation as sent (idempotent). Call after a successful dispatch.
 * If the reservation doesn't exist, this is a no-op.
 */
export function markSent(runId: string, recipient = ""): void {
  getDb().prepare(
    `UPDATE ${TABLE} SET sentAt = datetime('now')
     WHERE runId = ? AND recipient = ?`,
  ).run(runId, recipient);
}

/** Clear old records (older than N days, default 30) for cleanup. */
export function pruneSendCap(olderThanDays = 30): number {
  const result = getDb().prepare(
    `DELETE FROM ${TABLE}
     WHERE datetime(reservedAt) < datetime('now', '-' || ? || ' days')`,
  ).run(olderThanDays) as { changes: number };
  return result.changes ?? 0;
}

/**
 * Check whether a message has already been sent to this recipient in this run.
 * Used for reconciliation/auditing against the message store.
 */
export function alreadySent(runId: string, recipient = ""): boolean {
  const record = getDb().prepare(
    `SELECT sentAt FROM ${TABLE}
     WHERE runId = ? AND recipient = ? AND sentAt IS NOT NULL`,
  ).get(runId, recipient) as { sentAt?: string } | undefined;
  return !!record?.sentAt;
}

/** Get all sent messages for a run (for audit-trail reconciliation). */
export function getSentInRun(runId: string): SendCapRecord[] {
  return getDb().prepare(
    `SELECT _id, runId, recipient, sendId, reservedAt, sentAt
     FROM ${TABLE}
     WHERE runId = ? AND sentAt IS NOT NULL`,
  ).all(runId) as SendCapRecord[];
}
