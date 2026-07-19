/**
 * Pattern Nudges — a sixth heartbeat ritual (2026-07-19 spec, see
 * docs/superpowers/specs/2026-07-19-pattern-nudges-design.md). Detects
 * observable operator work-rhythm patterns (overextension, recurring missed
 * goals, low-motivation Mondays) purely from existing task/goal-checkin data
 * — no new mood/energy telemetry, no new tables. Rides the heartbeat tick
 * exactly like the other proactive rituals in heartbeat.ts: own enable flag
 * (off by default, unlike its siblings), own daily idempotence marker.
 *
 * Dep-injected the same way ratchet.ts is: `PatternNudgeDeps` bag of
 * injectable fetchers, `defaultPatternNudgeDeps` wiring the real
 * goals/store.ts + db calls. `runPatternDetectionPass` is the one non-pure
 * entry point (fetch + pure detection + pure composition); everything else
 * here is a pure, unit-tested building block. No `notify()`/`broadcastEvent`
 * call here — delivery belongs to heartbeat.ts's `tickPatternNudge` only.
 */

import { Task } from "@/lib/db";
import { listGoals, checkinsForGoal, type GoalCadence } from "@/lib/goals/store";

const PERIOD_DAYS: Record<GoalCadence, number> = { daily: 1, weekly: 7, milestone: 14 };
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Trailing 7 days of task activity timestamps. True when at least 12 fall
 * inside the window (a quiet week must not read as overextension for lack of
 * signal) AND at least 40% of those are late-night (22:00-05:00 local) or on
 * a weekend day.
 */
export function detectOverextension(activityTimestamps: string[], now: Date): boolean {
  const since = now.getTime() - 7 * DAY_MS;
  const windowed = activityTimestamps.filter((ts) => {
    const t = new Date(ts).getTime();
    return t >= since && t <= now.getTime();
  });
  if (windowed.length < 12) return false;
  const flagged = windowed.filter((ts) => {
    const d = new Date(ts);
    const hour = d.getHours();
    const day = d.getDay();
    return hour >= 22 || hour < 5 || day === 0 || day === 6;
  }).length;
  return flagged / windowed.length >= 0.4;
}

/** Local-midnight day diff, mirroring goals/store.ts's daysSince (avoids UTC-parse pitfalls on YYYY-MM-DD strings). */
function daysBetween(dateStr: string, now: Date): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const then = new Date(y, (m ?? 1) - 1, d ?? 1);
  const nowMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((nowMid.getTime() - then.getTime()) / DAY_MS);
}

/**
 * Partitions the trailing `windows` cadence-length periods (daily=1d,
 * weekly=7d, milestone=14d) and counts how many have zero check-ins.
 */
export function computeGoalMisses(cadence: GoalCadence, checkinDates: string[], now: Date, windows = 4): number {
  const periodDays = PERIOD_DAYS[cadence];
  let misses = 0;
  for (let i = 0; i < windows; i++) {
    const periodStart = i * periodDays;
    const periodEnd = (i + 1) * periodDays;
    const hasCheckin = checkinDates.some((d) => {
      const age = daysBetween(d, now);
      return age >= periodStart && age < periodEnd;
    });
    if (!hasCheckin) misses++;
  }
  return misses;
}

export interface GoalMissSummary {
  title: string;
  misses: number;
  windows: number;
  hasHistory: boolean;
}

/** Worst offender among active goals with >=2 of the last `windows` periods missed AND at least one historical check-in. */
export function detectMissedGoalPattern(goals: GoalMissSummary[]): { title: string; misses: number; windows: number } | null {
  const offenders = goals.filter((g) => g.hasHistory && g.misses >= 2);
  if (offenders.length === 0) return null;
  const worst = [...offenders].sort((a, b) => b.misses - a.misses)[0];
  return { title: worst.title, misses: worst.misses, windows: worst.windows };
}

/** Monday, local hour < 12, and check-ins + completions in the trailing 3 days below threshold. */
export function detectLowMotivationMonday(now: Date, trailingActivityCount: number, threshold = 2): boolean {
  if (now.getDay() !== 1) return false;
  if (now.getHours() >= 12) return false;
  return trailingActivityCount < threshold;
}

/** The same `kind` cannot fire again within `cooldownDays`; a different kind can still fire the next day. */
export function patternNudgeCooldownOk(
  lastKind: string | undefined,
  lastSentDay: string | undefined,
  candidateKind: string,
  now: Date,
  cooldownDays = 3,
): boolean {
  if (!lastKind || !lastSentDay) return true;
  if (lastKind !== candidateKind) return true;
  return daysBetween(lastSentDay, now) >= cooldownDays;
}

// ---------------------------------------------------------------------------
// pickRecentWin + composePatternNudge
// ---------------------------------------------------------------------------

/** Most recent completed task title or annotated goal check-in in the trailing lookback window. */
export function pickRecentWin(candidates: { title: string; at: string }[]): string | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0].title;
}

export type PatternNudgeKind = "overextension" | "missed-goal-pattern" | "low-motivation-monday";

export interface ComposePatternNudgeInput {
  overextended: boolean;
  missedGoal: { title: string; misses: number; windows: number } | null;
  lowMotivationMonday: boolean;
  recentWin: string | null;
}

/**
 * Priority order overextension > missed-goal-pattern > low-motivation-monday
 * (rarer/more consequential signal wins if more than one fires the same
 * day). Exactly one nudge per day, ever — this is the anti-nagging
 * guarantee.
 */
export function composePatternNudge(input: ComposePatternNudgeInput): { kind: PatternNudgeKind; message: string } | null {
  if (input.overextended) {
    return {
      kind: "overextension",
      message: "The last week has skewed heavily into late nights and weekends — want me to lighten what's queued, or just flag it for now?",
    };
  }
  if (input.missedGoal) {
    const { title, misses, windows } = input.missedGoal;
    return {
      kind: "missed-goal-pattern",
      message: `"${title}" has missed ${misses} of the last ${windows} check-ins — that's a pattern, not a one-off.`,
    };
  }
  if (input.lowMotivationMonday && input.recentWin) {
    return {
      kind: "low-motivation-monday",
      message: `Slow start to the week? Last week you: ${input.recentWin}.`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// runPatternDetectionPass — the one non-pure entry point.
// ---------------------------------------------------------------------------

export interface PatternGoalActivity {
  title: string;
  cadence: GoalCadence;
  checkinDates: string[]; // all available history (checkinsForGoal's cap), any order
}

export interface PatternNudgeDeps {
  listActiveGoalActivity: () => Promise<PatternGoalActivity[]> | PatternGoalActivity[];
  listTrailingTaskTimestamps: (sinceIso: string) => Promise<string[]> | string[];
  listRecentWinCandidates: (sinceIso: string) => Promise<{ title: string; at: string }[]> | { title: string; at: string }[];
  now: () => Date;
}

function defaultListActiveGoalActivity(): PatternGoalActivity[] {
  return listGoals({ status: "active" }).map((g) => ({
    title: g.title,
    cadence: g.cadence,
    checkinDates: checkinsForGoal(g.id, 60).map((c) => c.date),
  }));
}

async function defaultListTrailingTaskTimestamps(sinceIso: string): Promise<string[]> {
  const rows = await Task.find({
    $or: [{ createdAt: { $gte: sinceIso } }, { completedAt: { $gte: sinceIso } }],
  }).sort({ updatedAt: -1 }).limit(200);
  const out: string[] = [];
  for (const t of rows) {
    if (t.createdAt >= sinceIso) out.push(t.createdAt);
    if (t.completedAt && t.completedAt >= sinceIso) out.push(t.completedAt);
  }
  return out;
}

async function defaultListRecentWinCandidates(sinceIso: string): Promise<{ title: string; at: string }[]> {
  const rows = await Task.find({ status: "done", completedAt: { $gte: sinceIso } })
    .sort({ completedAt: -1 })
    .limit(20);
  const wins = rows.filter((t) => t.completedAt).map((t) => ({ title: t.title, at: t.completedAt as string }));
  for (const g of listGoals({ status: "active" })) {
    for (const c of checkinsForGoal(g.id, 10)) {
      if (c.note && c.createdAt >= sinceIso) wins.push({ title: `${g.title}: ${c.note}`, at: c.createdAt });
    }
  }
  return wins;
}

export const defaultPatternNudgeDeps: PatternNudgeDeps = {
  listActiveGoalActivity: defaultListActiveGoalActivity,
  listTrailingTaskTimestamps: defaultListTrailingTaskTimestamps,
  listRecentWinCandidates: defaultListRecentWinCandidates,
  now: () => new Date(),
};

const RECENT_WIN_LOOKBACK_MS = 14 * DAY_MS;
const LOW_MOTIVATION_LOOKBACK_MS = 3 * DAY_MS;
const OVEREXTENSION_FETCH_LOOKBACK_MS = 7 * DAY_MS;

/**
 * Fetch goal check-in history + trailing task activity, run the pure
 * detectors, and compose at most one nudge. No `notify()` call inside —
 * heartbeat.ts's `tickPatternNudge` owns delivery (and the cooldown check
 * against previously-sent kind/day).
 */
export async function runPatternDetectionPass(
  deps: PatternNudgeDeps = defaultPatternNudgeDeps,
): Promise<{ kind: PatternNudgeKind; message: string } | null> {
  const now = deps.now();
  const sevenDaysAgoIso = new Date(now.getTime() - OVEREXTENSION_FETCH_LOOKBACK_MS).toISOString();
  const fourteenDaysAgoIso = new Date(now.getTime() - RECENT_WIN_LOOKBACK_MS).toISOString();
  const threeDaysAgoIso = new Date(now.getTime() - LOW_MOTIVATION_LOOKBACK_MS).toISOString();

  const [goalActivity, taskTimestamps, winCandidates] = await Promise.all([
    deps.listActiveGoalActivity(),
    deps.listTrailingTaskTimestamps(sevenDaysAgoIso),
    deps.listRecentWinCandidates(fourteenDaysAgoIso),
  ]);

  const overextended = detectOverextension(taskTimestamps, now);

  const missedGoal = detectMissedGoalPattern(
    goalActivity.map((g) => ({
      title: g.title,
      misses: computeGoalMisses(g.cadence, g.checkinDates, now),
      windows: 4,
      hasHistory: g.checkinDates.length > 0,
    })),
  );

  const trailingTaskCount = taskTimestamps.filter((ts) => ts >= threeDaysAgoIso).length;
  const trailingCheckinCount = goalActivity.reduce(
    (sum, g) => sum + g.checkinDates.filter((d) => daysBetween(d, now) < 3).length,
    0,
  );
  const lowMotivationMonday = detectLowMotivationMonday(now, trailingTaskCount + trailingCheckinCount);

  const recentWin = pickRecentWin(winCandidates);

  return composePatternNudge({ overextended, missedGoal, lowMotivationMonday, recentWin });
}
