import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Isolate HOME so the DB is a fresh temp instance, never the developer's
// real ~/.hivematrix/hivematrix.db — same trick as flash/store.test.ts.
const TMP = mkdtempSync(join(tmpdir(), "hm-goals-store-test-"));
process.env.HOME = TMP;

const {
  upsertGoal, listGoals, getGoal, findGoalByTitle,
  addCheckin, checkinsForGoal, latestCheckin,
  goalsWithStatus, goalsDueToday, isDueToday, deleteGoal,
} = await import("./store");

test.after(() => rmSync(TMP, { recursive: true, force: true }));

test("upsertGoal: create then update by id", () => {
  const created = upsertGoal({ title: "Run 3x/week", category: "health", cadence: "weekly" });
  assert.ok(created.id);
  assert.equal(created.title, "Run 3x/week");
  assert.equal(created.status, "active");

  const updated = upsertGoal({ id: created.id, title: "Run 3x/week", target: "3 runs", status: "paused" });
  assert.equal(updated.id, created.id);
  assert.equal(updated.target, "3 runs");
  assert.equal(updated.status, "paused");
  assert.equal(updated.category, "health"); // untouched field preserved
});

test("upsertGoal: no id generates a new one, defaults cadence to weekly and status to active", () => {
  const g = upsertGoal({ title: "Learn Italian" });
  assert.ok(g.id);
  assert.equal(g.cadence, "weekly");
  assert.equal(g.status, "active");
  assert.equal(g.nextAction, null, "next action defaults to null");
});

test("upsertGoal: nextAction round-trips and is preserved when untouched on update", () => {
  const g = upsertGoal({ title: "Pass the annuities exam", nextAction: "sit a 30-min practice exam" });
  assert.equal(g.nextAction, "sit a 30-min practice exam");
  // Updating another field leaves nextAction intact...
  const same = upsertGoal({ id: g.id, title: "Pass the annuities exam", status: "active" });
  assert.equal(same.nextAction, "sit a 30-min practice exam");
  // ...and it can be advanced as progress is made.
  const advanced = upsertGoal({ id: g.id, title: "Pass the annuities exam", nextAction: "book the exam slot" });
  assert.equal(advanced.nextAction, "book the exam slot");
});

test("listGoals: returns goals ordered by sortOrder then createdAt, filterable by status", () => {
  const a = upsertGoal({ title: "List A", sortOrder: 2 });
  const b = upsertGoal({ title: "List B", sortOrder: 1 });
  upsertGoal({ id: a.id, title: "List A", status: "done" });

  const active = listGoals({ status: "active" });
  assert.ok(active.some((g) => g.id === b.id));
  assert.ok(!active.some((g) => g.id === a.id));

  const done = listGoals({ status: "done" });
  assert.ok(done.some((g) => g.id === a.id));
});

test("getGoal: returns null for unknown id", () => {
  assert.equal(getGoal("does-not-exist"), null);
});

test("addCheckin + checkinsForGoal + latestCheckin", () => {
  const g = upsertGoal({ title: "Bible reading", cadence: "daily" });
  const c1 = addCheckin({ goalId: g.id, note: "Read Psalm 1", date: "2026-07-10" });
  const c2 = addCheckin({ goalId: g.id, note: "Read Psalm 2", date: "2026-07-11" });
  assert.ok(c1.id && c2.id);

  const list = checkinsForGoal(g.id);
  assert.equal(list.length, 2);
  // Most recent date first
  assert.equal(list[0].date, "2026-07-11");

  const latest = latestCheckin(g.id);
  assert.equal(latest?.note, "Read Psalm 2");
});

test("addCheckin: defaults date to today (local) when omitted", () => {
  const g = upsertGoal({ title: "Default date goal" });
  const c = addCheckin({ goalId: g.id, note: "did it" });
  const today = new Date();
  const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  assert.equal(c.date, expected);
});

test("findGoalByTitle: case-insensitive substring match, prefers active goal", () => {
  upsertGoal({ title: "Italian practice", status: "done" });
  const active = upsertGoal({ title: "Italian vocabulary", status: "active" });
  const found = findGoalByTitle("italian");
  assert.equal(found?.id, active.id);
});

test("findGoalByTitle: no match returns null", () => {
  assert.equal(findGoalByTitle("no such goal exists anywhere"), null);
});

// ---------------------------------------------------------------------------
// dueToday rules per cadence
// ---------------------------------------------------------------------------

test("isDueToday: a goal with no check-ins is always due", () => {
  assert.equal(isDueToday("daily", null), true);
  assert.equal(isDueToday("weekly", null), true);
  assert.equal(isDueToday("milestone", null), true);
});

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("isDueToday: daily — checked in today is NOT due; checked in yesterday IS due", () => {
  assert.equal(isDueToday("daily", daysAgoStr(0)), false);
  assert.equal(isDueToday("daily", daysAgoStr(1)), true);
});

test("isDueToday: weekly — within 7 days NOT due; 7+ days IS due", () => {
  assert.equal(isDueToday("weekly", daysAgoStr(3)), false);
  assert.equal(isDueToday("weekly", daysAgoStr(6)), false);
  assert.equal(isDueToday("weekly", daysAgoStr(7)), true);
  assert.equal(isDueToday("weekly", daysAgoStr(10)), true);
});

test("isDueToday: milestone — within 14 days NOT due; 14+ days IS due", () => {
  assert.equal(isDueToday("milestone", daysAgoStr(10)), false);
  assert.equal(isDueToday("milestone", daysAgoStr(13)), false);
  assert.equal(isDueToday("milestone", daysAgoStr(14)), true);
  assert.equal(isDueToday("milestone", daysAgoStr(20)), true);
});

// ---------------------------------------------------------------------------
// goalsWithStatus / goalsDueToday shape
// ---------------------------------------------------------------------------

test("goalsWithStatus: shape includes latestCheckin, dueToday, streak, checkinCount, lastCheckinDate", () => {
  const g = upsertGoal({ title: "Shape test goal", cadence: "daily" });
  addCheckin({ goalId: g.id, note: "day 1", date: daysAgoStr(1) });
  addCheckin({ goalId: g.id, note: "day 0", date: daysAgoStr(0) });

  const all = goalsWithStatus();
  const found = all.find((x) => x.id === g.id);
  assert.ok(found);
  assert.equal(found?.dueToday, false); // checked in today
  assert.equal(found?.lastCheckinDate, daysAgoStr(0));
  assert.equal(found?.checkinCount, 2);
  assert.equal(found?.streak, 2);
  assert.equal(found?.latestCheckin?.note, "day 0");
});

test("goalsWithStatus: only includes active goals", () => {
  const paused = upsertGoal({ title: "Paused goal", status: "paused" });
  const all = goalsWithStatus();
  assert.ok(!all.some((g) => g.id === paused.id));
});

test("goalsDueToday: filters goalsWithStatus to due + active", () => {
  const dueGoal = upsertGoal({ title: "Overdue weekly", cadence: "weekly" });
  addCheckin({ goalId: dueGoal.id, date: daysAgoStr(10) });
  const notDueGoal = upsertGoal({ title: "Recent weekly", cadence: "weekly" });
  addCheckin({ goalId: notDueGoal.id, date: daysAgoStr(1) });

  const due = goalsDueToday();
  assert.ok(due.some((g) => g.id === dueGoal.id));
  assert.ok(!due.some((g) => g.id === notDueGoal.id));
});

test("deleteGoal: soft delete marks status done (default), keeps history", () => {
  const g = upsertGoal({ title: "To be retired" });
  addCheckin({ goalId: g.id, note: "history entry" });
  const ok = deleteGoal(g.id);
  assert.equal(ok, true);
  assert.equal(getGoal(g.id)?.status, "done");
  assert.equal(checkinsForGoal(g.id).length, 1);
});

test("deleteGoal: hard delete removes the goal and its check-ins", () => {
  const g = upsertGoal({ title: "To be hard-deleted" });
  addCheckin({ goalId: g.id, note: "will vanish" });
  const ok = deleteGoal(g.id, true);
  assert.equal(ok, true);
  assert.equal(getGoal(g.id), null);
  assert.equal(checkinsForGoal(g.id).length, 0);
});

test("deleteGoal: unknown id returns false", () => {
  assert.equal(deleteGoal("does-not-exist"), false);
});
