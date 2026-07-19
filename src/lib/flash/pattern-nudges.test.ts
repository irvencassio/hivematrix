import test from "node:test";
import assert from "node:assert/strict";

import {
  detectOverextension,
  computeGoalMisses,
  detectMissedGoalPattern,
  detectLowMotivationMonday,
  patternNudgeCooldownOk,
  pickRecentWin,
  composePatternNudge,
  runPatternDetectionPass,
  type PatternNudgeDeps,
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

// ---------------------------------------------------------------------------
// Task 2 — pickRecentWin + composePatternNudge
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Task 3 — runPatternDetectionPass: the one impure entry point
// ---------------------------------------------------------------------------

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
