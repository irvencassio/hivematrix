/**
 * Success scoreboard — the accountability layer's outcome signal.
 *
 * GOALS.md is the aspirational list; the *measurable* objectives in HiveMatrix are
 * directive criteria (prover-gated — a criterion only closes when a prover proves
 * it). This ties the two together with the objective signals that answer "are we
 * actually delivering?": criteria proven, this week's task outcomes, and pipeline
 * first-pass quality. Surfaced in the brief so the partner layer reports progress
 * against goals with numbers, not vibes.
 *
 * All reads are local + best-effort; a missing source degrades to 0/null, never throws.
 */

import { getDb } from "@/lib/db";

export interface Scoreboard {
  /** Aspirational goals written in persona/GOALS.md. */
  goalsTracked: number;
  /** Prover-gated objectives met vs total, across ACTIVE directives. */
  criteriaProven: number;
  criteriaTotal: number;
  /** Distinct tasks that succeeded / failed in the trailing window. */
  tasksDone: number;
  tasksFailed: number;
  windowDays: number;
  /** Overall first-attempt success rate across the window (0..1), or null with no data. */
  firstPassRate: number | null;
}

/** Pure: is there enough signal to bother reporting a scoreboard line? */
export function scoreboardHasSignal(s: Scoreboard): boolean {
  return s.criteriaTotal > 0 || s.tasksDone + s.tasksFailed > 0 || s.goalsTracked > 0;
}

interface CountRow { n: number }
interface CritRow { total: number; proven: number }

/**
 * Gather the scoreboard from local state. `goalsTracked` is injected (the caller
 * already reads GOALS.md for the brief); everything else is a local DB read.
 */
export function getScoreboard(goalsTracked = 0, windowDays = 7): Scoreboard {
  const db = getDb();
  const since = `-${Math.max(1, windowDays)} days`;

  let criteriaTotal = 0;
  let criteriaProven = 0;
  try {
    const c = db
      .prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(proven), 0) AS proven
           FROM directive_criteria
          WHERE directiveId IN (SELECT _id FROM directives WHERE status = 'active')`,
      )
      .get() as CritRow | undefined;
    criteriaTotal = Number(c?.total ?? 0);
    criteriaProven = Number(c?.proven ?? 0);
  } catch { /* no directives yet */ }

  // Task outcomes over the window: distinct tasks by their FIRST-attempt result, so a
  // retried task counts once. done/review = success; failed = failure.
  let tasksDone = 0;
  let tasksFailed = 0;
  let firstAttempts = 0;
  let firstPasses = 0;
  try {
    const rows = db
      .prepare(
        `SELECT taskId, status FROM task_telemetry
          WHERE runIndex = 0 AND createdAt >= datetime('now', ?)`,
      )
      .all(since) as Array<{ taskId: string; status: string }>;
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.taskId)) continue;
      seen.add(r.taskId);
      firstAttempts++;
      const ok = r.status === "done" || r.status === "review";
      if (ok) { firstPasses++; tasksDone++; } else if (r.status === "failed") { tasksFailed++; }
    }
  } catch { /* no telemetry yet */ }

  return {
    goalsTracked,
    criteriaProven,
    criteriaTotal,
    tasksDone,
    tasksFailed,
    windowDays,
    firstPassRate: firstAttempts ? Math.round((firstPasses / firstAttempts) * 1000) / 1000 : null,
  };
}
