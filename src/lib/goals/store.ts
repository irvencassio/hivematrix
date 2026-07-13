/**
 * Goals layer — DB access layer.
 *
 * A native accountability/progress-tracking store, distinct from brain docs
 * (durable prose) and from directives/tasks (one-shot or scheduled work
 * items). Goals are long-horizon and recurring (ARR, fitness, a language,
 * scripture reading); goal_checkins is the append-only progress history a
 * goal accrues over time. Mirrors flash/store.ts: pure functions over
 * getDb(), no cloud calls, no framework.
 */

import { generateId, getDb } from "@/lib/db";

export type GoalCadence = "daily" | "weekly" | "milestone";
export type GoalStatus = "active" | "paused" | "done";

export interface Goal {
  id: string;
  title: string;
  category: string | null;
  description: string | null;
  cadence: GoalCadence;
  target: string | null;
  metricUnit: string | null;
  /** The explicit "do this next" step — the one concrete action toward this goal. */
  nextAction: string | null;
  status: GoalStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface GoalCheckin {
  id: string;
  goalId: string;
  date: string;
  note: string | null;
  value: number | null;
  createdAt: string;
}

export interface GoalWithStatus extends Goal {
  latestCheckin: GoalCheckin | null;
  lastCheckinDate: string | null;
  dueToday: boolean;
  streak: number;
  checkinCount: number;
}

interface GoalRow {
  id: string;
  title: string;
  category: string | null;
  description: string | null;
  cadence: string;
  target: string | null;
  metricUnit: string | null;
  nextAction: string | null;
  status: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

function rowToGoal(row: GoalRow): Goal {
  return {
    ...row,
    cadence: (row.cadence as GoalCadence) ?? "weekly",
    status: (row.status as GoalStatus) ?? "active",
  };
}

export interface UpsertGoalInput {
  id?: string;
  title: string;
  category?: string | null;
  description?: string | null;
  cadence?: GoalCadence;
  target?: string | null;
  metricUnit?: string | null;
  nextAction?: string | null;
  status?: GoalStatus;
  sortOrder?: number;
}

/** Insert a new goal, or update an existing one by id. Always sets updatedAt. */
export function upsertGoal(input: UpsertGoalInput): Goal {
  const db = getDb();
  const now = new Date().toISOString();

  if (input.id) {
    const existing = db.prepare("SELECT * FROM goals WHERE id = ?").get(input.id) as GoalRow | undefined;
    if (existing) {
      const merged: GoalRow = {
        ...existing,
        title: input.title ?? existing.title,
        category: input.category !== undefined ? input.category : existing.category,
        description: input.description !== undefined ? input.description : existing.description,
        cadence: input.cadence ?? existing.cadence,
        target: input.target !== undefined ? input.target : existing.target,
        metricUnit: input.metricUnit !== undefined ? input.metricUnit : existing.metricUnit,
        nextAction: input.nextAction !== undefined ? input.nextAction : existing.nextAction,
        status: input.status ?? existing.status,
        sortOrder: input.sortOrder ?? existing.sortOrder,
        updatedAt: now,
      };
      db.prepare(
        `UPDATE goals SET title = ?, category = ?, description = ?, cadence = ?, target = ?, metricUnit = ?, nextAction = ?, status = ?, sortOrder = ?, updatedAt = ?
         WHERE id = ?`,
      ).run(
        merged.title, merged.category, merged.description, merged.cadence, merged.target,
        merged.metricUnit, merged.nextAction, merged.status, merged.sortOrder, merged.updatedAt, merged.id,
      );
      return rowToGoal(merged);
    }
  }

  const id = input.id ?? generateId();
  const row: GoalRow = {
    id,
    title: input.title,
    category: input.category ?? null,
    description: input.description ?? null,
    cadence: input.cadence ?? "weekly",
    target: input.target ?? null,
    metricUnit: input.metricUnit ?? null,
    nextAction: input.nextAction ?? null,
    status: input.status ?? "active",
    sortOrder: input.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO goals (id, title, category, description, cadence, target, metricUnit, nextAction, status, sortOrder, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id, row.title, row.category, row.description, row.cadence, row.target,
    row.metricUnit, row.nextAction, row.status, row.sortOrder, row.createdAt, row.updatedAt,
  );
  return rowToGoal(row);
}

export interface ListGoalsOpts {
  status?: GoalStatus;
}

/** All goals (optionally filtered by status), ordered by sortOrder then createdAt. */
export function listGoals(opts: ListGoalsOpts = {}): Goal[] {
  const db = getDb();
  const rows = opts.status
    ? (db.prepare("SELECT * FROM goals WHERE status = ? ORDER BY sortOrder ASC, createdAt ASC").all(opts.status) as GoalRow[])
    : (db.prepare("SELECT * FROM goals ORDER BY sortOrder ASC, createdAt ASC").all() as GoalRow[]);
  return rows.map(rowToGoal);
}

export function getGoal(id: string): Goal | null {
  const row = getDb().prepare("SELECT * FROM goals WHERE id = ?").get(id) as GoalRow | undefined;
  return row ? rowToGoal(row) : null;
}

/**
 * Fuzzy-resolve a goal by title text: case-insensitive substring match.
 * Prefers an active goal; among ties prefers the most recently updated.
 * Returns null if nothing matches.
 */
export function findGoalByTitle(text: string): Goal | null {
  const needle = (text || "").trim().toLowerCase();
  if (!needle) return null;
  const rows = getDb().prepare("SELECT * FROM goals ORDER BY updatedAt DESC").all() as GoalRow[];
  const goals = rows.map(rowToGoal);

  const matches = goals.filter((g) => g.title.toLowerCase().includes(needle));
  if (matches.length === 0) return null;

  const active = matches.find((g) => g.status === "active");
  return active ?? matches[0];
}

/** Today's date in local time as YYYY-MM-DD. */
function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface AddCheckinInput {
  goalId: string;
  note?: string | null;
  value?: number | null;
  date?: string;
}

export function addCheckin(input: AddCheckinInput): GoalCheckin {
  const db = getDb();
  const id = generateId();
  const now = new Date().toISOString();
  const date = input.date ?? todayLocal();
  const note = input.note ?? null;
  const value = input.value ?? null;
  db.prepare(
    "INSERT INTO goal_checkins (id, goalId, date, note, value, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, input.goalId, date, note, value, now);
  // A check-in is progress — bump the goal's updatedAt so "recently touched"
  // ordering (e.g. findGoalByTitle's tie-break) reflects it.
  db.prepare("UPDATE goals SET updatedAt = ? WHERE id = ?").run(now, input.goalId);
  return { id, goalId: input.goalId, date, note, value, createdAt: now };
}

export function checkinsForGoal(goalId: string, limit = 30): GoalCheckin[] {
  return getDb()
    .prepare("SELECT * FROM goal_checkins WHERE goalId = ? ORDER BY date DESC, createdAt DESC LIMIT ?")
    .all(goalId, limit) as GoalCheckin[];
}

export function latestCheckin(goalId: string): GoalCheckin | null {
  const row = getDb()
    .prepare("SELECT * FROM goal_checkins WHERE goalId = ? ORDER BY date DESC, createdAt DESC LIMIT 1")
    .get(goalId) as GoalCheckin | undefined;
  return row ?? null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days between a YYYY-MM-DD date string and today (local), floor-truncated. */
function daysSince(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const then = new Date(y, (m ?? 1) - 1, d ?? 1);
  const now = new Date();
  const nowMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((nowMid.getTime() - then.getTime()) / DAY_MS);
}

/**
 * Whether a goal with the given cadence and last-checkin date is due today:
 *  - daily: due unless already checked in today (0 days since).
 *  - weekly: due unless a check-in within the last 7 days.
 *  - milestone: due unless a check-in within the last 14 days.
 * A goal with no check-ins yet is always due.
 */
export function isDueToday(cadence: GoalCadence, lastCheckinDate: string | null): boolean {
  if (!lastCheckinDate) return true;
  const since = daysSince(lastCheckinDate);
  if (cadence === "daily") return since >= 1;
  if (cadence === "weekly") return since >= 7;
  return since >= 14; // milestone
}

/** Simple streak: count of consecutive most-recent check-in DAYS (deduped) going backward with no gaps > 1 day, starting from the most recent check-in. */
function computeStreak(checkins: GoalCheckin[]): number {
  if (checkins.length === 0) return 0;
  const dates = Array.from(new Set(checkins.map((c) => c.date))).sort().reverse();
  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const gap = daysSince(dates[i]) - daysSince(dates[i - 1]);
    if (gap === 1) streak++;
    else break;
  }
  return streak;
}

/**
 * Every active goal enriched with its latest check-in, whether it's due
 * today, and a simple streak/checkinCount. This is the shape the Goals panel
 * and the goals_list/daily_review tools both read from.
 */
export function goalsWithStatus(): GoalWithStatus[] {
  const goals = listGoals({ status: "active" });
  return goals.map((goal) => {
    const checkins = checkinsForGoal(goal.id, 60);
    const latest = checkins[0] ?? null;
    return {
      ...goal,
      latestCheckin: latest,
      lastCheckinDate: latest?.date ?? null,
      dueToday: isDueToday(goal.cadence, latest?.date ?? null),
      streak: computeStreak(checkins),
      checkinCount: checkins.length,
    };
  });
}

/** Active goals that are due today, per their cadence rule. */
export function goalsDueToday(): GoalWithStatus[] {
  return goalsWithStatus().filter((g) => g.dueToday && g.status === "active");
}

/** Soft-delete: mark a goal done rather than removing history. Pass hard=true to actually delete the row + its check-ins. */
export function deleteGoal(id: string, hard = false): boolean {
  const db = getDb();
  if (hard) {
    db.prepare("DELETE FROM goal_checkins WHERE goalId = ?").run(id);
    const result = db.prepare("DELETE FROM goals WHERE id = ?").run(id);
    return result.changes > 0;
  }
  const result = db.prepare("UPDATE goals SET status = 'done', updatedAt = ? WHERE id = ?").run(new Date().toISOString(), id);
  return result.changes > 0;
}
