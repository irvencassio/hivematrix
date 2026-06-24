import test from "node:test";
import assert from "node:assert/strict";
import { parseVideoScheduleConfig, weeklyDraftDue } from "./news-schedule";

test("parseVideoScheduleConfig clamps + defaults", () => {
  assert.deepEqual(parseVideoScheduleConfig(undefined), { enabled: false, weekday: 1, hour: 8, privacy: "unlisted" });
  const p = parseVideoScheduleConfig({ enabled: true, weekday: 9, hour: 30, privacy: "public" });
  assert.equal(p.enabled, true);
  assert.equal(p.weekday, 6, "weekday clamped to 0-6");
  assert.equal(p.hour, 23, "hour clamped to 0-23");
  assert.equal(p.privacy, "public");
  assert.equal(parseVideoScheduleConfig({ privacy: "bogus" }).privacy, "unlisted", "invalid privacy falls back");
});

test("weeklyDraftDue fires once on the target weekday after the hour", () => {
  // 2026-06-22 is a Monday (getDay() === 1).
  const cfg = { enabled: true, weekday: 1, hour: 8, privacy: "unlisted" } as const;
  assert.equal(weeklyDraftDue(cfg, new Date("2026-06-22T07:00:00")), false, "before the hour");
  assert.equal(weeklyDraftDue(cfg, new Date("2026-06-22T09:00:00")), true, "after the hour, never run");
  assert.equal(weeklyDraftDue(cfg, new Date("2026-06-23T09:00:00")), false, "wrong weekday (Tue)");
  // lastRunAt this week → not due again
  const ran = { ...cfg, lastRunAt: "2026-06-22T08:05:00" };
  assert.equal(weeklyDraftDue(ran, new Date("2026-06-22T10:00:00")), false, "already ran this week");
  // next week, same weekday → due again
  assert.equal(weeklyDraftDue(ran, new Date("2026-06-29T09:00:00")), true, "next Monday");
});

test("disabled never fires", () => {
  assert.equal(weeklyDraftDue({ enabled: false, weekday: 1, hour: 8, privacy: "unlisted" }, new Date("2026-06-22T09:00:00")), false);
});
