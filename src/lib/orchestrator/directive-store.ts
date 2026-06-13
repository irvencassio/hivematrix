/**
 * Data-access helpers for directives, runs, the run journal, and criteria.
 *
 * Thin raw-SQL layer over the v6–v10 tables. The directive engine
 * (directive-engine.ts) is the only writer of run phase transitions; this
 * module just persists and reads.
 */

import { getDb, generateId } from "@/lib/db";

export type RunPhase = "plan" | "execute" | "verify" | "reflect" | "done" | "failed";
export type DirectiveStatus = "active" | "sleeping" | "blocked" | "done" | "retired";

export interface DirectiveRow {
  _id: string;
  goal: string;
  triggerPolicy: string;   // JSON
  budgetPolicy: string;    // JSON
  approvalPolicy: string;  // JSON
  brainSelection: string;  // JSON
  status: DirectiveStatus;
  profile: string;
  project: string;
  projectPath: string;
  lastRunId: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  retiredReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunRow {
  _id: string;
  directiveId: string;
  phase: RunPhase;
  planSummary: string | null;
  reflectionText: string | null;
  startedAt: string;
  completedAt: string | null;
  failedAt: string | null;
  failReason: string | null;
  createdAt: string;
}

export interface CriterionRow {
  _id: string;
  directiveId: string;
  description: string;
  proverId: string | null;
  proverType: string | null;
  proven: number;       // 0 | 1
  provenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JournalEntry {
  _id: number;
  runId: string;
  directiveId: string;
  step: string;
  payload: string;      // JSON
  recordedAt: string;
}

// --- Directives ------------------------------------------------------------

export interface CreateDirectiveInput {
  goal: string;
  triggerPolicy?: Record<string, unknown>;
  budgetPolicy?: Record<string, unknown>;
  approvalPolicy?: Record<string, unknown>;
  brainSelection?: unknown;
  profile: string;
  project: string;
  projectPath: string;
  nextRunAt?: string | null;
  status?: DirectiveStatus;
}

export function createDirective(input: CreateDirectiveInput): DirectiveRow {
  const db = getDb();
  const id = generateId();
  db.prepare(
    `INSERT INTO directives
      (_id, goal, triggerPolicy, budgetPolicy, approvalPolicy, brainSelection,
       status, profile, project, projectPath, nextRunAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.goal,
    JSON.stringify(input.triggerPolicy ?? { type: "manual" }),
    JSON.stringify(input.budgetPolicy ?? {}),
    JSON.stringify(input.approvalPolicy ?? {}),
    JSON.stringify(input.brainSelection ?? []),
    input.status ?? "active",
    input.profile,
    input.project,
    input.projectPath,
    input.nextRunAt ?? null,
  );
  return getDirective(id)!;
}

export function getDirective(id: string): DirectiveRow | null {
  return (getDb().prepare("SELECT * FROM directives WHERE _id = ?").get(id) as DirectiveRow | undefined) ?? null;
}

/** Every directive, newest first — used by ManagerBee for the control-plane report. */
export function listDirectives(): DirectiveRow[] {
  return getDb().prepare("SELECT * FROM directives ORDER BY createdAt DESC").all() as DirectiveRow[];
}

/** Active directives that are due to run (nextRunAt <= now, or null = run-immediately). */
export function getDueDirectives(nowIso: string): DirectiveRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM directives
       WHERE status = 'active'
         AND (nextRunAt IS NULL OR nextRunAt <= ?)
       ORDER BY createdAt ASC`
    )
    .all(nowIso) as DirectiveRow[];
}

export function updateDirective(id: string, fields: Partial<DirectiveRow>): void {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setClause = [...keys.map((k) => `${k} = ?`), "updatedAt = datetime('now')"].join(", ");
  getDb().prepare(`UPDATE directives SET ${setClause} WHERE _id = ?`).run(...Object.values(fields), id);
}

// --- Runs ------------------------------------------------------------------

export function createRun(directiveId: string): RunRow {
  const db = getDb();
  const id = generateId();
  db.prepare("INSERT INTO runs (_id, directiveId, phase) VALUES (?, ?, 'plan')").run(id, directiveId);
  return getRun(id)!;
}

export function getRun(id: string): RunRow | null {
  return (getDb().prepare("SELECT * FROM runs WHERE _id = ?").get(id) as RunRow | undefined) ?? null;
}

/** Runs not yet in a terminal phase (the engine advances these each tick). */
export function getActiveRuns(): RunRow[] {
  return getDb()
    .prepare("SELECT * FROM runs WHERE phase NOT IN ('done', 'failed') ORDER BY startedAt ASC")
    .all() as RunRow[];
}

export function setRunPhase(id: string, phase: RunPhase, fields: Partial<RunRow> = {}): void {
  const merged: Partial<RunRow> = { ...fields, phase };
  const keys = Object.keys(merged);
  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  getDb().prepare(`UPDATE runs SET ${setClause} WHERE _id = ?`).run(...Object.values(merged), id);
}

// --- Journal ---------------------------------------------------------------

export function journal(runId: string, directiveId: string, step: string, payload: Record<string, unknown> = {}): void {
  getDb()
    .prepare("INSERT INTO run_journal (runId, directiveId, step, payload) VALUES (?, ?, ?, ?)")
    .run(runId, directiveId, step, JSON.stringify(payload));
}

export function getJournal(runId: string): JournalEntry[] {
  return getDb().prepare("SELECT * FROM run_journal WHERE runId = ? ORDER BY _id ASC").all(runId) as JournalEntry[];
}

// --- Criteria --------------------------------------------------------------

export function addCriterion(directiveId: string, description: string, proverType?: string, proverId?: string): CriterionRow {
  const db = getDb();
  const id = generateId();
  db.prepare(
    "INSERT INTO directive_criteria (_id, directiveId, description, proverType, proverId) VALUES (?, ?, ?, ?, ?)"
  ).run(id, directiveId, description, proverType ?? null, proverId ?? null);
  return getDb().prepare("SELECT * FROM directive_criteria WHERE _id = ?").get(id) as CriterionRow;
}

export function getCriteria(directiveId: string): CriterionRow[] {
  return getDb()
    .prepare("SELECT * FROM directive_criteria WHERE directiveId = ? ORDER BY createdAt ASC")
    .all(directiveId) as CriterionRow[];
}

/** Mark a criterion proven. The engine's verify step is the only caller. */
export function markCriterionProven(id: string, provenAtIso: string): void {
  getDb()
    .prepare("UPDATE directive_criteria SET proven = 1, provenAt = ?, updatedAt = datetime('now') WHERE _id = ?")
    .run(provenAtIso, id);
}

export function allCriteriaProven(directiveId: string): boolean {
  const criteria = getCriteria(directiveId);
  if (criteria.length === 0) return false; // a directive with no criteria can never self-report done
  return criteria.every((c) => c.proven === 1);
}

/** Delete a directive and all its runs, criteria, and journal entries. */
export function deleteDirective(id: string): boolean {
  const db = getDb();
  // Gather run IDs so we can clean up journal entries.
  const runs = db.prepare("SELECT _id FROM runs WHERE directiveId = ?").all(id) as Array<{ _id: string }>;
  const runIds = runs.map((r) => r._id);

  db.prepare("DELETE FROM run_journal WHERE directiveId = ?").run(id);
  if (runIds.length > 0) {
    const placeholders = runIds.map(() => "?").join(",");
    db.prepare(`DELETE FROM runs WHERE directiveId = ? AND _id IN (${placeholders})`).run([id, ...runIds]);
  }
  db.prepare("DELETE FROM directive_criteria WHERE directiveId = ?").run(id);
  const result = db.prepare("DELETE FROM directives WHERE _id = ?").run(id);
  return result.changes > 0;
}
