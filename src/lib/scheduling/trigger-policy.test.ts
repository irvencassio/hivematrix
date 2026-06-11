import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDurationMs,
  computeNextRunAt,
  isDue,
  parseTriggerPolicy,
  type ScheduleTrigger,
} from "./trigger-policy";

// ---------------------------------------------------------------------------
// parseDurationMs
// ---------------------------------------------------------------------------

test("parseDurationMs: PT4H → 4 hours in ms", () => {
  assert.equal(parseDurationMs("PT4H"), 4 * 60 * 60 * 1000);
});

test("parseDurationMs: P1D → 1 day in ms", () => {
  assert.equal(parseDurationMs("P1D"), 24 * 60 * 60 * 1000);
});

test("parseDurationMs: PT30M → 30 minutes in ms", () => {
  assert.equal(parseDurationMs("PT30M"), 30 * 60 * 1000);
});

test("parseDurationMs: P1W → 7 days in ms", () => {
  assert.equal(parseDurationMs("P1W"), 7 * 24 * 60 * 60 * 1000);
});

test("parseDurationMs: P2DT3H → 51 hours in ms", () => {
  assert.equal(parseDurationMs("P2DT3H"), (2 * 24 + 3) * 60 * 60 * 1000);
});

test("parseDurationMs: invalid string returns null", () => {
  assert.equal(parseDurationMs("every day"), null);
  assert.equal(parseDurationMs(""), null);
  assert.equal(parseDurationMs("P0D"), null);
});

// ---------------------------------------------------------------------------
// computeNextRunAt — interval
// ---------------------------------------------------------------------------

test("computeNextRunAt: interval PT4H from lastRunAt", () => {
  const trigger: ScheduleTrigger = { type: "schedule", interval: "PT4H" };
  const lastRun = new Date("2026-06-11T10:00:00Z");
  const now = new Date("2026-06-11T11:00:00Z");
  const next = computeNextRunAt(trigger, lastRun.toISOString(), now);
  assert.equal(next, new Date("2026-06-11T14:00:00Z").toISOString());
});

test("computeNextRunAt: interval PT4H from now when lastRunAt is null", () => {
  const trigger: ScheduleTrigger = { type: "schedule", interval: "PT4H" };
  const now = new Date("2026-06-11T10:00:00Z");
  const next = computeNextRunAt(trigger, null, now);
  assert.equal(next, new Date("2026-06-11T14:00:00Z").toISOString());
});

test("computeNextRunAt: when last+interval is in the past, schedules from now", () => {
  const trigger: ScheduleTrigger = { type: "schedule", interval: "PT1H" };
  const lastRun = new Date("2026-06-11T06:00:00Z");
  const now = new Date("2026-06-11T12:00:00Z"); // 6h after lastRun
  const next = computeNextRunAt(trigger, lastRun.toISOString(), now);
  // next should be now + 1h (not lastRun + 1h, which is past)
  assert.equal(next, new Date("2026-06-11T13:00:00Z").toISOString());
});

test("computeNextRunAt: returns null for non-schedule triggers", () => {
  assert.equal(computeNextRunAt({ type: "manual" }, null), null);
  assert.equal(computeNextRunAt({ type: "continuous" }, null), null);
});

test("computeNextRunAt: returns null for invalid interval", () => {
  const trigger: ScheduleTrigger = { type: "schedule", interval: "garbage" };
  assert.equal(computeNextRunAt(trigger, null), null);
});

// ---------------------------------------------------------------------------
// computeNextRunAt — dailyAt
// ---------------------------------------------------------------------------

test("computeNextRunAt: dailyAt schedules for same day if hour not yet passed", () => {
  const trigger: ScheduleTrigger = { type: "schedule", dailyAt: 20 };
  // Simulate 10am local by using UTC for test consistency
  const now = new Date("2026-06-11T10:00:00");
  const next = computeNextRunAt(trigger, null, now);
  assert.ok(next !== null);
  const nextDate = new Date(next!);
  assert.equal(nextDate.getHours(), 20);
  assert.equal(nextDate.getDate(), now.getDate());
});

test("computeNextRunAt: dailyAt advances to tomorrow if hour already passed today", () => {
  const trigger: ScheduleTrigger = { type: "schedule", dailyAt: 6 };
  const now = new Date("2026-06-11T10:00:00"); // already past 6am
  const next = computeNextRunAt(trigger, null, now);
  assert.ok(next !== null);
  const nextDate = new Date(next!);
  assert.equal(nextDate.getHours(), 6);
  assert.equal(nextDate.getDate(), now.getDate() + 1);
});

// ---------------------------------------------------------------------------
// isDue
// ---------------------------------------------------------------------------

test("isDue: returns true when nextRunAt is in the past", () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  assert.equal(isDue(past), true);
});

test("isDue: returns false when nextRunAt is in the future", () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(isDue(future), false);
});

test("isDue: returns false for null", () => {
  assert.equal(isDue(null), false);
});

// ---------------------------------------------------------------------------
// parseTriggerPolicy
// ---------------------------------------------------------------------------

test("parseTriggerPolicy: parses schedule policy from JSON", () => {
  const policy = parseTriggerPolicy(JSON.stringify({ type: "schedule", interval: "PT4H" }));
  assert.ok(policy !== null);
  assert.equal(policy!.type, "schedule");
});

test("parseTriggerPolicy: returns null for invalid JSON", () => {
  assert.equal(parseTriggerPolicy("not json"), null);
  assert.equal(parseTriggerPolicy(null), null);
});

test("parseTriggerPolicy: returns null for unknown type", () => {
  assert.equal(parseTriggerPolicy(JSON.stringify({ type: "cron" })), null);
});
