# Pattern Nudges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-07-19-pattern-nudges-design.md` (approved
2026-07-19 — "Looks good"). Read it first; this plan does not repeat its
rationale, only the exact tasks.

Shape recap: a sixth heartbeat ritual, same shape as Day Brief / Ratchet /
Weaver Audit (`src/lib/flash/{day-brief,ratchet,weaver-audit}.ts` +
`src/lib/flash/heartbeat.ts`). Zero new tables, zero new schedulers, zero new
delivery planes. One new module (`src/lib/flash/pattern-nudges.ts`), six new
`HeartbeatConfig` fields, one new `tickPatternNudge` wired into `tick()`, one
new settings-endpoint patch block. **Off by default even for fresh installs**
(unlike the other three rituals, which default on).

Test runner: `node:test` + `node:assert/strict` (see `ratchet.test.ts` for the
exact style to copy — `fakeDeps()` factory, pure-function tests via
`assert.equal`/`assert.deepEqual`/`assert.match`, impure entry point tested via
dependency injection asserting both return value and call/no-call flags).

---

## Task 1 — Pure detectors: overextension, goal misses, low-motivation-Monday, cooldown

**File:** `src/lib/flash/pattern-nudges.ts` (new)
**Test file:** `src/lib/flash/pattern-nudges.test.ts` (new)

Write the failing tests first, then the minimal implementation.

```ts
// pattern-nudges.test.ts (excerpt — write all of these before any implementation exists)
import test from "node:test";
import assert from "node:assert/strict";
import {
  detectOverextension,
  computeGoalMisses,
  detectMissedGoalPattern,
  detectLowMotivationMonday,
  patternNudgeCooldownOk,
} from "./pattern-nudges";

const NOW = new Date(2026, 6, 20, 9, 0, 0); // Monday, local time (2026-07-20 is a Monday)

test("detectOverextension: false below the 12-timestamp floor even if all flagged", () => {
  const iso = (h: number) => new Date(2026, 6, 19, h, 0, 0).toISOString(); // Sunday (weekend)
  const timestamps = Array.from({ length: 11 }, () => iso(23));
  assert.equal(detectOverextension(timestamps, NOW), false);
});

test("detectOverextension: true at >=40% late-night/weekend with >=12 timestamps in the trailing 7 days", () => {
  const weekend = new Date(2026, 6, 19, 23, 0, 0).toISOString(); // Sunday 23:00 — flagged
  const weekday = new Date(2026, 6, 15, 14, 0, 0).toISOString(); // Wednesday 14:00 — not flagged
  const timestamps = [...Array(5).fill(weekend), ...Array(7).fill(weekday)]; // 5/12 = 41.6%
  assert.equal(detectOverextension(timestamps, NOW), true);
});

test("detectOverextension: timestamps outside the trailing 7 days don't count toward the floor or the fraction", () => {
  const tooOld = new Date(2026, 5, 1, 23, 0, 0).toISOString(); // weeks ago
  const recent = new Date(2026, 6, 18, 14, 0, 0).toISOString();
  const timestamps = [...Array(20).fill(tooOld), ...Array(11).fill(recent)];
  assert.equal(detectOverextension(timestamps, NOW), false); // only 11 in-window
});

test("computeGoalMisses: daily cadence counts zero-checkin trailing days", () => {
  // NOW is 2026-07-20. Daily windows are single days: [19,20), [18,19), [17,18), [16,17).
  const misses = computeGoalMisses("daily", ["2026-07-18"], NOW, 4);
  assert.equal(misses, 3); // only the 07-18 period has a checkin
});

test("computeGoalMisses: weekly/milestone cadence partitions into 7d/14d periods", () => {
  assert.equal(computeGoalMisses("weekly", ["2026-07-19"], NOW, 4), 3);
  assert.equal(computeGoalMisses("milestone", [], NOW, 4), 4);
});

test("detectMissedGoalPattern: worst offender among goals with >=2/4 misses AND prior history", () => {
  const result = detectMissedGoalPattern([
    { title: "No history", misses: 4, windows: 4, hasHistory: false },
    { title: "Mild", misses: 1, windows: 4, hasHistory: true },
    { title: "Worst", misses: 3, windows: 4, hasHistory: true },
    { title: "Also bad", misses: 2, windows: 4, hasHistory: true },
  ]);
  assert.deepEqual(result, { title: "Worst", misses: 3, windows: 4 });
});

test("detectMissedGoalPattern: null when nothing qualifies", () => {
  assert.equal(detectMissedGoalPattern([{ title: "Fine", misses: 1, windows: 4, hasHistory: true }]), null);
  assert.equal(detectMissedGoalPattern([]), null);
});

test("detectLowMotivationMonday: only Monday morning, below threshold", () => {
  assert.equal(detectLowMotivationMonday(NOW, 1, 2), true);
  assert.equal(detectLowMotivationMonday(NOW, 2, 2), false); // at threshold, not below
  assert.equal(detectLowMotivationMonday(new Date(2026, 6, 20, 13, 0, 0), 0, 2), false); // afternoon
  assert.equal(detectLowMotivationMonday(new Date(2026, 6, 21, 9, 0, 0), 0, 2), false); // Tuesday
});

test("patternNudgeCooldownOk: blocks the SAME kind within cooldownDays, allows a different kind immediately", () => {
  assert.equal(patternNudgeCooldownOk("overextension", "2026-07-19", "overextension", NOW, 3), false);
  assert.equal(patternNudgeCooldownOk("overextension", "2026-07-16", "overextension", NOW, 3), true); // 4 days ago
  assert.equal(patternNudgeCooldownOk("overextension", "2026-07-19", "missed-goal-pattern", NOW, 3), true);
  assert.equal(patternNudgeCooldownOk(undefined, undefined, "overextension", NOW), true); // never sent
});
```

Implementation notes (write only enough to pass the above):

```ts
// pattern-nudges.ts (top section)
import type { GoalCadence } from "@/lib/goals/store";

const PERIOD_DAYS: Record<GoalCadence, number> = { daily: 1, weekly: 7, milestone: 14 };
const DAY_MS = 24 * 60 * 60 * 1000;

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

export function detectMissedGoalPattern(goals: GoalMissSummary[]): { title: string; misses: number; windows: number } | null {
  const offenders = goals.filter((g) => g.hasHistory && g.misses >= 2);
  if (offenders.length === 0) return null;
  const worst = [...offenders].sort((a, b) => b.misses - a.misses)[0];
  return { title: worst.title, misses: worst.misses, windows: worst.windows };
}

export function detectLowMotivationMonday(now: Date, trailingActivityCount: number, threshold = 2): boolean {
  if (now.getDay() !== 1) return false;
  if (now.getHours() >= 12) return false;
  return trailingActivityCount < threshold;
}

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
```

- [ ] Write `pattern-nudges.test.ts` with the tests above (RED — file under test doesn't exist yet).
- [ ] Write `pattern-nudges.ts` with only the code above (GREEN).
- [ ] `npx tsx --test src/lib/flash/pattern-nudges.test.ts` (or the repo's `npm test` filter) passes.

---

## Task 2 — `pickRecentWin` + `composePatternNudge`

**File:** `src/lib/flash/pattern-nudges.ts` (append)
**Test file:** `src/lib/flash/pattern-nudges.test.ts` (append)

```ts
test("pickRecentWin: most recent candidate by `at`, title only; null when empty", () => {
  assert.equal(pickRecentWin([]), null);
  assert.equal(
    pickRecentWin([
      { title: "older", at: "2026-07-10T09:00:00.000Z" },
      { title: "newest", at: "2026-07-18T09:00:00.000Z" },
      { title: "middle", at: "2026-07-15T09:00:00.000Z" },
    ]),
    "newest",
  );
});

test("composePatternNudge: priority is overextension > missed-goal > low-motivation-Monday", () => {
  const missedGoal = { title: "Read scripture", misses: 3, windows: 4 };
  const all = composePatternNudge({ overextended: true, missedGoal, lowMotivationMonday: true, recentWin: "shipped the release" });
  assert.equal(all?.kind, "overextension");

  const goalWins = composePatternNudge({ overextended: false, missedGoal, lowMotivationMonday: true, recentWin: "shipped the release" });
  assert.equal(goalWins?.kind, "missed-goal-pattern");
  assert.match(goalWins?.message ?? "", /pattern, not a one-off/);

  const monday = composePatternNudge({ overextended: false, missedGoal: null, lowMotivationMonday: true, recentWin: "shipped the release" });
  assert.equal(monday?.kind, "low-motivation-monday");
  assert.match(monday?.message ?? "", /shipped the release/);
});

test("composePatternNudge: overextension is phrased as an open offer, never a push", () => {
  const result = composePatternNudge({ overextended: true, missedGoal: null, lowMotivationMonday: false, recentWin: null });
  assert.doesNotMatch(result?.message ?? "", /you should/i);
  assert.match(result?.message ?? "", /want me to|flag it/i);
});

test("composePatternNudge: low-motivation-Monday with no real win to surface suppresses entirely", () => {
  assert.equal(composePatternNudge({ overextended: false, missedGoal: null, lowMotivationMonday: true, recentWin: null }), null);
});

test("composePatternNudge: nothing detected returns null", () => {
  assert.equal(composePatternNudge({ overextended: false, missedGoal: null, lowMotivationMonday: false, recentWin: null }), null);
});
```

```ts
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
```

- [ ] Append the tests above (RED).
- [ ] Append the implementation above (GREEN).

---

## Task 3 — `runPatternDetectionPass`: the one impure entry point

**File:** `src/lib/flash/pattern-nudges.ts` (append)
**Test file:** `src/lib/flash/pattern-nudges.test.ts` (append)

Mirrors `runRatchetPass`'s `RatchetDeps`/`fakeDeps` shape exactly — a deps bag
of injectable fetchers, a `defaultPatternNudgeDeps` wiring the real
`goals/store.ts` + `db` calls, tested here purely via `fakeDeps` (no real DB).

```ts
import {
  runPatternDetectionPass,
  type PatternNudgeDeps,
} from "./pattern-nudges";

function fakeDeps(over: Partial<PatternNudgeDeps> = {}): PatternNudgeDeps {
  return {
    listActiveGoalActivity: async () => [],
    listTrailingTaskTimestamps: async () => [],
    listRecentWinCandidates: async () => [],
    now: () => NOW,
    ...over,
  };
}

test("runPatternDetectionPass: no signal at all returns null", async () => {
  const result = await runPatternDetectionPass(fakeDeps());
  assert.equal(result, null);
});

test("runPatternDetectionPass: overextension signal wins even with a concurrent goal-miss pattern", async () => {
  const lateNight = new Date(2026, 6, 19, 23, 0, 0).toISOString();
  const result = await runPatternDetectionPass(fakeDeps({
    listTrailingTaskTimestamps: async () => Array(15).fill(lateNight),
    listActiveGoalActivity: async () => [{ title: "Devotions", cadence: "daily", checkinDates: [] }],
  }));
  assert.equal(result?.kind, "overextension");
});

test("runPatternDetectionPass: missed-goal-pattern surfaces when it's the only signal", async () => {
  const result = await runPatternDetectionPass(fakeDeps({
    listActiveGoalActivity: async () => [
      { title: "Devotions", cadence: "daily", checkinDates: ["2026-07-15"] }, // 4 daily periods back, all missed except one outside window -> still counts as history
    ],
  }));
  assert.equal(result?.kind, "missed-goal-pattern");
  assert.equal(result?.message.includes("Devotions"), true);
});

test("runPatternDetectionPass: low-motivation-Monday surfaces a real win, never fires with no win available", async () => {
  const mondayDeps = fakeDeps({
    now: () => NOW, // NOW is Monday per Task 1 constant
    listRecentWinCandidates: async () => [{ title: "shipped the release", at: "2026-07-18T09:00:00.000Z" }],
  });
  const result = await runPatternDetectionPass(mondayDeps);
  assert.equal(result?.kind, "low-motivation-monday");

  const noWin = await runPatternDetectionPass(fakeDeps({ now: () => NOW }));
  assert.equal(noWin, null);
});
```

Implementation:

```ts
import { Task } from "@/lib/db";
import { listGoals, checkinsForGoal } from "@/lib/goals/store";

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

async function defaultListActiveGoalActivity(): Promise<PatternGoalActivity[]> {
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
```

- [ ] Append the tests above (RED — `runPatternDetectionPass` doesn't exist yet).
- [ ] Append the implementation above (GREEN).
- [ ] Full file review: confirm no `notify()`/`broadcastEvent`/`appendOperatorTurn` call anywhere in `pattern-nudges.ts` — delivery belongs in `heartbeat.ts` only, per the design's explicit split.

---

## Task 4 — `HeartbeatConfig` fields + parse/seed

**File:** `src/lib/flash/heartbeat.ts`
**Test file:** `src/lib/flash/heartbeat.test.ts` (append)

Add to `HeartbeatConfig` (after the Weaver block, `heartbeat.ts:112`):

```ts
  /** Pattern Nudges (2026-07-19 spec) — daily, OFF by default even for fresh
   * installs (unlike Day Brief/Ratchet/Weaver): this ritual comments on the
   * operator's own work patterns, so it's opt-in after seeing what it says. */
  patternNudgeEnabled: boolean;
  patternNudgeHour: number;   // default 9
  patternNudgeMinute: number; // default 0
  lastPatternNudgeCheckedDay?: string; // local YYYY-MM-DD — at most one detection pass/day
  lastPatternNudgeSentDay?: string;    // local YYYY-MM-DD — only set when a nudge actually sent
  lastPatternNudgeKind?: string;       // for the 3-day same-kind cooldown
```

Add consts near `DEFAULT_WEAVER_MINUTE` (`heartbeat.ts:128`):

```ts
const DEFAULT_PATTERN_NUDGE_HOUR = 9;
const DEFAULT_PATTERN_NUDGE_MINUTE = 0;
```

**Do NOT add `patternNudgeEnabled: true` to `DEFAULT_CONFIG`** (this is the
mechanism that keeps it off for fresh installs, unlike the other three — see
`parseHeartbeatConfig`'s `!input` branch which spreads `DEFAULT_CONFIG`
verbatim). Only add the hour/minute defaults there:

```ts
  patternNudgeEnabled: false,
  patternNudgeHour: DEFAULT_PATTERN_NUDGE_HOUR,
  patternNudgeMinute: DEFAULT_PATTERN_NUDGE_MINUTE,
```

In `parseHeartbeatConfig` (`heartbeat.ts:182`), add after the Weaver fields:

```ts
    patternNudgeEnabled: obj.patternNudgeEnabled === true,
    patternNudgeHour: clampHour(obj.patternNudgeHour) ?? DEFAULT_PATTERN_NUDGE_HOUR,
    patternNudgeMinute: clampMinute(obj.patternNudgeMinute) ?? DEFAULT_PATTERN_NUDGE_MINUTE,
    lastPatternNudgeCheckedDay: typeof obj.lastPatternNudgeCheckedDay === "string" ? obj.lastPatternNudgeCheckedDay : undefined,
    lastPatternNudgeSentDay: typeof obj.lastPatternNudgeSentDay === "string" ? obj.lastPatternNudgeSentDay : undefined,
    lastPatternNudgeKind: typeof obj.lastPatternNudgeKind === "string" ? obj.lastPatternNudgeKind : undefined,
```

In `setHeartbeatConfig` (`heartbeat.ts:259`, right after the Weaver seeding
block), seed ONLY `lastPatternNudgeCheckedDay` on enable — deliberately NOT
`lastPatternNudgeSentDay`, so enabling mid-pattern doesn't retroactively start
a cooldown for something that was never actually sent:

```ts
  // Pattern Nudges: enabling must not immediately run today's detection pass
  // from a stale/absent marker. Unlike the others, do NOT seed
  // lastPatternNudgeSentDay — a fresh enable has sent nothing, so the 3-day
  // cooldown must start clean the first time a nudge actually fires.
  if (next.patternNudgeEnabled && !current.patternNudgeEnabled) {
    const today = localDateString(new Date());
    if (!("lastPatternNudgeCheckedDay" in patch)) next.lastPatternNudgeCheckedDay = current.lastPatternNudgeCheckedDay ?? today;
  }
```

Tests to add to `heartbeat.test.ts` (find the existing `parseHeartbeatConfig`
describe block and the enable-seeding tests for Ratchet/Weaver — copy their
shape):

```ts
test("parseHeartbeatConfig: patternNudgeEnabled defaults false even via DEFAULT_CONFIG spread (fresh install stays off)", () => {
  const config = parseHeartbeatConfig(undefined);
  assert.equal(config.patternNudgeEnabled, false);
  assert.equal(config.patternNudgeHour, 9);
  assert.equal(config.patternNudgeMinute, 0);
});

test("parseHeartbeatConfig: patternNudgeEnabled true only when explicitly stored true", () => {
  assert.equal(parseHeartbeatConfig({ patternNudgeEnabled: true }).patternNudgeEnabled, true);
  assert.equal(parseHeartbeatConfig({ patternNudgeEnabled: false }).patternNudgeEnabled, false);
  assert.equal(parseHeartbeatConfig({}).patternNudgeEnabled, false);
});
```

(For the `setHeartbeatConfig` seeding test, follow whatever fixture pattern
the existing Ratchet/Weaver seeding tests use in this file — likely stubbing
`loadHiveConfig`/`saveHiveConfig` or using a temp config dir; match it exactly
rather than inventing a new fixture style.)

- [ ] Add the config field block, consts, `DEFAULT_CONFIG` additions (RED first: write the two tests above against the not-yet-updated interface — they'll fail to typecheck/compile, which counts as RED for a type-level change).
- [ ] Add `parseHeartbeatConfig` fields, `setHeartbeatConfig` seeding block (GREEN).
- [ ] Add and pass a `setHeartbeatConfig` seeding test mirroring the existing Ratchet/Weaver one.

---

## Task 5 — `tickPatternNudge` wired into `tick()`

**File:** `src/lib/flash/heartbeat.ts`
**Test file:** `src/lib/flash/heartbeat.test.ts` (append)

Import at the top (`heartbeat.ts:75`, after the Weaver import):

```ts
import { runPatternDetectionPass, patternNudgeCooldownOk, type PatternNudgeKind } from "./pattern-nudges";
```

Add to `HeartbeatDeps` (`heartbeat.ts:524`, after `composeWeaverAudit`):

```ts
  /** Pattern Nudges daily pass (pattern-nudges.ts) — injectable for tests; defaults to the real one. */
  runPatternDetectionPass?: typeof runPatternDetectionPass;
```

Add the tick function (`heartbeat.ts`, right after `tickWeaver`, before `let stopFn`):

```ts
/**
 * Pattern Nudges due-check + dispatch — same "own enable flag, folded into
 * the shared tick" shape as `tickDayBriefRitual`, at day granularity (reuses
 * `dayBriefMomentDue` verbatim). Unlike the other three rituals, a detected
 * pattern can still be suppressed by `patternNudgeCooldownOk` (the same
 * `kind` cannot repeat within 3 days) — checked AFTER the detection pass,
 * before delivery.
 */
async function tickPatternNudge(config: HeartbeatConfig, now: Date, deps: HeartbeatDeps): Promise<void> {
  if (!config.patternNudgeEnabled) return;
  if (!dayBriefMomentDue(config.patternNudgeHour, config.patternNudgeMinute, config.lastPatternNudgeCheckedDay, now)) return;

  // Mark BEFORE the pass so a slow pass can't double-fire later today.
  setHeartbeatConfig({ lastPatternNudgeCheckedDay: localDateString(now) });
  try {
    const runPass = deps.runPatternDetectionPass ?? runPatternDetectionPass;
    const result = await runPass();
    if (!result) {
      console.log("[heartbeat] pattern nudge pass: nothing to say");
      return;
    }
    if (!patternNudgeCooldownOk(config.lastPatternNudgeKind, config.lastPatternNudgeSentDay, result.kind, now)) {
      console.log(`[heartbeat] pattern nudge pass: ${result.kind} suppressed by cooldown`);
      return;
    }
    if (deps.notify) {
      try { await deps.notify(result.message); } catch { /* channels are best-effort */ }
    }
    setHeartbeatConfig({ lastPatternNudgeSentDay: localDateString(now), lastPatternNudgeKind: result.kind });
    broadcastEvent("flash:pattern-nudge", { kind: result.kind, ts: now.toISOString() });
    console.log(`[heartbeat] pattern nudge delivered (kind=${result.kind})`);
  } catch (e) {
    console.error(`[heartbeat] pattern nudge pass failed: ${e instanceof Error ? e.message : e}`);
  }
}
```

Wire into `tick()` (`heartbeat.ts:852`, after `await tickWeaver(...)`):

```ts
  await tickWeaver(config, now, deps);
  await tickPatternNudge(config, now, deps);
```

Tests (mirror `heartbeat.test.ts`'s existing Ratchet/Weaver tick tests — find
and copy their `fakeConfig`/deps-stubbing fixture exactly):

```ts
test("tickPatternNudge: disabled is a no-op — no due-check, no notify", async () => {
  let notified = false;
  await tickPatternNudge(
    { ...BASE_CONFIG, patternNudgeEnabled: false },
    at(9),
    { notify: async () => { notified = true; } },
  );
  assert.equal(notified, false);
});

test("tickPatternNudge: due + a detected pattern + cooldown OK delivers and marks sent", async () => {
  let notifiedText: string | null = null;
  await tickPatternNudge(
    { ...BASE_CONFIG, patternNudgeEnabled: true, patternNudgeHour: 9, patternNudgeMinute: 0 },
    at(9),
    {
      notify: async (t) => { notifiedText = t; },
      runPatternDetectionPass: async () => ({ kind: "overextension", message: "flag text" }),
    },
  );
  assert.equal(notifiedText, "flag text");
});

test("tickPatternNudge: same kind within 3-day cooldown suppresses delivery", async () => {
  let notified = false;
  await tickPatternNudge(
    {
      ...BASE_CONFIG,
      patternNudgeEnabled: true,
      lastPatternNudgeKind: "overextension",
      lastPatternNudgeSentDay: localDateString(at(9)), // "sent today" already, same kind
    },
    at(9),
    {
      notify: async () => { notified = true; },
      runPatternDetectionPass: async () => ({ kind: "overextension", message: "flag text" }),
    },
  );
  assert.equal(notified, false);
});

test("tickPatternNudge: no pattern detected does not notify or mark sent", async () => {
  let notified = false;
  await tickPatternNudge(
    { ...BASE_CONFIG, patternNudgeEnabled: true },
    at(9),
    { notify: async () => { notified = true; }, runPatternDetectionPass: async () => null },
  );
  assert.equal(notified, false);
});
```

(`BASE_CONFIG` — use whatever minimal-valid-`HeartbeatConfig` fixture the
existing `tickRatchet`/`tickWeaver` tests in this file already build; extend
it rather than duplicating it. These tests will need `setHeartbeatConfig`'s
real read/write path exercised or stubbed exactly the way the existing
Ratchet/Weaver tick tests handle it — match that fixture, don't invent a new
one.)

- [ ] Add the tests above, adapted to match this file's actual existing config-fixture/stubbing helper (RED).
- [ ] Add `tickPatternNudge` + wire into `tick()` + `HeartbeatDeps` field (GREEN).
- [ ] Update the file-header doc comment block (`heartbeat.ts:1-60`) with a short paragraph for Pattern Nudges, matching the style of the existing Day Brief/Ratchet+Weaver paragraphs, and add its config keys to the `Config (~/.hivematrix/config.json):` doc-comment list.

---

## Task 6 — Settings endpoint patch fields

**File:** `src/daemon/server.ts`

In the `POST /settings/heartbeat` handler (`server.ts:797`, after the
Ratchet/Weaver patch lines, before `json(res, 200, ...)`):

```ts
        // Pattern Nudges (2026-07-19 spec) — own enable flag, daily, off by
        // default even for fresh installs.
        if ("patternNudgeEnabled" in body) patch.patternNudgeEnabled = body.patternNudgeEnabled === true;
        if (typeof body.patternNudgeHour === "number") patch.patternNudgeHour = body.patternNudgeHour;
        if (typeof body.patternNudgeMinute === "number") patch.patternNudgeMinute = body.patternNudgeMinute;
```

No new route is needed — `GET /settings/heartbeat` already round-trips the
full `HeartbeatConfig` including any new fields via `getHeartbeatConfig()`.

- [ ] If `src/daemon/server.test.ts` has an existing test asserting the shape
  of `POST /settings/heartbeat`'s accepted patch keys (grep for
  `ratchetEnabled` in that file first), extend it to cover
  `patternNudgeEnabled`/`patternNudgeHour`/`patternNudgeMinute` (RED, then
  GREEN). If no such test exists for the sibling rituals either, skip adding
  one here too — match existing coverage, don't add a new coverage class this
  endpoint's siblings don't have.

---

## Task 7 — DECISIONS.md entry (Q23)

Per AGENTS.md's complexity budget: any new product concept needs an entry
naming what it replaces or deletes (here: nothing is replaced — this is
purely additive, which the entry should say explicitly). Use the design
doc's own "Complexity accounting" section (bottom of
`docs/superpowers/specs/2026-07-19-pattern-nudges-design.md`) as the source
material; do not re-derive it. Follow the exact section format of `## Q22` in
`DECISIONS.md` (Context / Decision / accounting / Deferred / Code / Provers).

- [ ] Append `## Q23 — Pattern Nudges: a sixth heartbeat ritual (2026-07-19)` to `DECISIONS.md`, adapted from the design doc's complexity-accounting section, listing: 0 new stores, 0 new orchestration primitives, 0 new delivery planes, 1 new module, and the new *product* concept (pattern-aware proactive commentary) as the thing actually being decided here.

---

## Finishing

- [ ] `npm run typecheck` — zero errors.
- [ ] `npm test` — all tests passing, including all new `pattern-nudges.test.ts` and `heartbeat.test.ts` additions.
- [ ] `node scripts/scope-wall.mjs` — zero violations.
- [ ] Re-read `docs/superpowers/specs/2026-07-19-pattern-nudges-design.md` against the final diff — confirm every bullet in "Shape" and "New module" landed, and that the "Deferred" section's three items were NOT accidentally implemented (no mood/energy logging surface, no autonomous mitigation/auto-lightening, no attempt to "tune" the constants beyond the best-first-guess values given).
- [ ] Git hygiene (AGENTS.md): stage only the files this plan touched by name —
  `src/lib/flash/pattern-nudges.ts`, `src/lib/flash/pattern-nudges.test.ts`,
  `src/lib/flash/heartbeat.ts`, `src/lib/flash/heartbeat.test.ts`,
  `src/daemon/server.ts` (and its test file only if Task 6 touched it),
  `DECISIONS.md`, this plan file, and the design doc (already committed or
  not — check `git status` first). Never `git add -A`. Commit to the current
  branch (or `hive/task-<taskId>` if one was created for this task). Do NOT
  merge to main, do NOT resolve conflicts, do NOT release — the operator does
  both.
