/**
 * Flight Loop store — durable loop policy and pass history for the quality-pass
 * runner attached to a Flight. DB tables: flight_loops, flight_loop_passes
 * (migration v28 in src/lib/db/index.ts).
 *
 * See docs/superpowers/specs/2026-06-27-flight-loops-quality-passes-design.md.
 */

import { generateId, getDb } from "@/lib/db";
import { scrubSecretText } from "@/lib/workflows/runs";

export type LoopMode = "off" | "manual" | "fixed" | "self_paced";
export type LoopStatus = "idle" | "active" | "running" | "paused" | "stopped";
export type PassProfile = "quality" | "goal_quality" | "release" | "watch" | "personal_admin";
export type PassStatus = "running" | "completed" | "failed" | "skipped";

export interface FlightLoop {
  id: string;
  packageId: string;
  mode: LoopMode;
  profile: PassProfile;
  status: LoopStatus;
  maxPasses: number;
  passCount: number;
  cadenceSeconds: number | null;
  nextRunAt: string | null;
  expiresAt: string | null;
  autoCreateItems: boolean;
  autoReadySafeItems: boolean;
  stopReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FlightLoopPass {
  id: string;
  loopId: string;
  packageId: string;
  passNumber: number;
  profile: PassProfile;
  status: PassStatus;
  startedAt: string;
  completedAt: string | null;
  summary: string | null;
  evidence: Record<string, unknown>;
  createdItemIds: string[];
  stopReason: string | null;
  error: string | null;
}

interface LoopRow {
  _id: string;
  packageId: string;
  mode: string;
  profile: string;
  status: string;
  maxPasses: number;
  passCount: number;
  cadenceSeconds: number | null;
  nextRunAt: string | null;
  expiresAt: string | null;
  autoCreateItems: number;
  autoReadySafeItems: number;
  stopReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PassRow {
  _id: string;
  loopId: string;
  packageId: string;
  passNumber: number;
  profile: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  summary: string | null;
  evidenceJson: string | null;
  createdItemIdsJson: string | null;
  stopReason: string | null;
  error: string | null;
}

function parseJsonArray(v: string | null | undefined): string[] {
  if (!v) return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}

function parseJsonObject(v: string | null | undefined): Record<string, unknown> {
  if (!v) return {};
  try {
    const p = JSON.parse(v);
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  } catch { return {}; }
}

function rowToLoop(r: LoopRow): FlightLoop {
  return {
    id: r._id,
    packageId: r.packageId,
    mode: r.mode as LoopMode,
    profile: r.profile as PassProfile,
    status: r.status as LoopStatus,
    maxPasses: r.maxPasses,
    passCount: r.passCount,
    cadenceSeconds: r.cadenceSeconds,
    nextRunAt: r.nextRunAt,
    expiresAt: r.expiresAt,
    autoCreateItems: r.autoCreateItems !== 0,
    autoReadySafeItems: r.autoReadySafeItems !== 0,
    stopReason: r.stopReason,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function rowToPass(r: PassRow): FlightLoopPass {
  return {
    id: r._id,
    loopId: r.loopId,
    packageId: r.packageId,
    passNumber: r.passNumber,
    profile: r.profile as PassProfile,
    status: r.status as PassStatus,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    summary: r.summary,
    evidence: parseJsonObject(r.evidenceJson),
    createdItemIds: parseJsonArray(r.createdItemIdsJson),
    stopReason: r.stopReason,
    error: r.error,
  };
}

export function getLoop(packageId: string): FlightLoop | null {
  const row = getDb()
    .prepare("SELECT * FROM flight_loops WHERE packageId = ?")
    .get(packageId) as LoopRow | undefined;
  return row ? rowToLoop(row) : null;
}

export interface UpsertLoopInput {
  mode?: LoopMode;
  profile?: PassProfile;
  maxPasses?: number;
  cadenceSeconds?: number | null;
  expiresAt?: string | null;
  autoCreateItems?: boolean;
  autoReadySafeItems?: boolean;
}

export function upsertLoop(packageId: string, input: UpsertLoopInput): FlightLoop {
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM flight_loops WHERE packageId = ?")
    .get(packageId) as LoopRow | undefined;
  const now = new Date().toISOString();

  if (!existing) {
    const id = generateId();
    const defaultExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO flight_loops
        (_id, packageId, mode, profile, status, maxPasses, cadenceSeconds, nextRunAt,
         expiresAt, autoCreateItems, autoReadySafeItems, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, 'idle', ?, ?, NULL, ?, ?, ?, ?, ?)
    `).run(
      id,
      packageId,
      input.mode ?? "manual",
      input.profile ?? "quality",
      input.maxPasses ?? 3,
      input.cadenceSeconds ?? null,
      input.expiresAt !== undefined ? input.expiresAt : defaultExpiry,
      input.autoCreateItems !== undefined ? (input.autoCreateItems ? 1 : 0) : 1,
      input.autoReadySafeItems !== undefined ? (input.autoReadySafeItems ? 1 : 0) : 0,
      now,
      now,
    );
  } else {
    const sets: string[] = ["updatedAt = ?"];
    const params: unknown[] = [now];
    if (input.mode !== undefined) { sets.push("mode = ?"); params.push(input.mode); }
    if (input.profile !== undefined) { sets.push("profile = ?"); params.push(input.profile); }
    if (input.maxPasses !== undefined) { sets.push("maxPasses = ?"); params.push(input.maxPasses); }
    if (input.cadenceSeconds !== undefined) { sets.push("cadenceSeconds = ?"); params.push(input.cadenceSeconds); }
    if (input.expiresAt !== undefined) { sets.push("expiresAt = ?"); params.push(input.expiresAt); }
    if (input.autoCreateItems !== undefined) { sets.push("autoCreateItems = ?"); params.push(input.autoCreateItems ? 1 : 0); }
    if (input.autoReadySafeItems !== undefined) { sets.push("autoReadySafeItems = ?"); params.push(input.autoReadySafeItems ? 1 : 0); }
    db.prepare(`UPDATE flight_loops SET ${sets.join(", ")} WHERE _id = ?`).run(...params, existing._id);
  }

  return getLoop(packageId)!;
}

/** Pause an idle/active loop. Rejects if a pass is currently running. */
export function pauseLoop(packageId: string): FlightLoop | null {
  const db = getDb();
  const row = db
    .prepare("SELECT _id, status FROM flight_loops WHERE packageId = ?")
    .get(packageId) as { _id: string; status: string } | undefined;
  if (!row) return null;
  if (row.status === "running" || row.status === "stopped" || row.status === "paused") return null;
  db.prepare(
    "UPDATE flight_loops SET status = 'paused', stopReason = 'manually_paused', updatedAt = ? WHERE _id = ?",
  ).run(new Date().toISOString(), row._id);
  return getLoop(packageId);
}

/** Resume a paused loop. Returns null if loop is not found or not paused. */
export function resumeLoop(packageId: string): FlightLoop | null {
  const db = getDb();
  const row = db
    .prepare("SELECT _id, status, mode FROM flight_loops WHERE packageId = ?")
    .get(packageId) as { _id: string; status: string; mode: string } | undefined;
  if (!row || row.status !== "paused") return null;
  const nextStatus: LoopStatus = row.mode === "fixed" ? "active" : "idle";
  db.prepare(
    "UPDATE flight_loops SET status = ?, stopReason = NULL, updatedAt = ? WHERE _id = ?",
  ).run(nextStatus, new Date().toISOString(), row._id);
  return getLoop(packageId);
}

export function getLoopPasses(loopId: string, limit = 50): FlightLoopPass[] {
  const rows = getDb()
    .prepare("SELECT * FROM flight_loop_passes WHERE loopId = ? ORDER BY passNumber DESC LIMIT ?")
    .all(loopId, limit) as PassRow[];
  return rows.map(rowToPass);
}

export function createPass(
  loopId: string,
  packageId: string,
  profile: PassProfile,
  passNumber: number,
): FlightLoopPass {
  const id = generateId();
  const now = new Date().toISOString();
  getDb()
    .prepare(`
      INSERT INTO flight_loop_passes (_id, loopId, packageId, passNumber, profile, status, startedAt)
      VALUES (?, ?, ?, ?, ?, 'running', ?)
    `)
    .run(id, loopId, packageId, passNumber, profile, now);
  return rowToPass(
    getDb().prepare("SELECT * FROM flight_loop_passes WHERE _id = ?").get(id) as PassRow,
  );
}

export interface CompletePassInput {
  status: PassStatus;
  summary: string | null;
  evidence: Record<string, unknown>;
  createdItemIds: string[];
  stopReason: string | null;
  error?: string | null;
}

export function completePass(passId: string, input: CompletePassInput): FlightLoopPass {
  const now = new Date().toISOString();
  getDb()
    .prepare(`
      UPDATE flight_loop_passes
      SET status = ?, completedAt = ?, summary = ?, evidenceJson = ?,
          createdItemIdsJson = ?, stopReason = ?, error = ?
      WHERE _id = ?
    `)
    .run(
      input.status,
      now,
      input.summary ? scrubSecretText(input.summary) : null,
      JSON.stringify(input.evidence),
      JSON.stringify(input.createdItemIds),
      input.stopReason,
      input.error ?? null,
      passId,
    );
  return rowToPass(
    getDb().prepare("SELECT * FROM flight_loop_passes WHERE _id = ?").get(passId) as PassRow,
  );
}

/**
 * Immediately schedule the next self-paced pass for a Flight by setting
 * nextRunAt to now. Call this when a child item transitions to done/failed/review.
 * No-op if no self_paced loop exists, or the loop is stopped/paused/running.
 */
export function notifySelfPacedLoop(packageId: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE flight_loops
       SET nextRunAt = ?, updatedAt = ?
       WHERE packageId = ? AND mode = 'self_paced' AND status IN ('idle', 'active')`,
    )
    .run(now, now, packageId);
}

export function updateLoopAfterPass(
  loopId: string,
  newPassCount: number,
  nextStatus: LoopStatus,
  stopReason: string | null,
  nextRunAt: string | null,
): void {
  getDb()
    .prepare(`
      UPDATE flight_loops
      SET passCount = ?, status = ?, stopReason = ?, nextRunAt = ?, updatedAt = ?
      WHERE _id = ?
    `)
    .run(newPassCount, nextStatus, stopReason, nextRunAt, new Date().toISOString(), loopId);
}
