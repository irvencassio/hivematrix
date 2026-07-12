import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMorningBriefingConfig,
  briefingDue,
  runBriefingNow,
  type MorningBriefingConfig,
} from "./morning-briefing";

test("parseMorningBriefingConfig clamps the hour and defaults to disabled", () => {
  assert.deepEqual(parseMorningBriefingConfig(undefined), { enabled: false, hour: 8 });
  assert.equal(parseMorningBriefingConfig({ hour: 99 }).hour, 23);
  assert.equal(parseMorningBriefingConfig({ hour: -5 }).hour, 0);
  assert.equal(parseMorningBriefingConfig({ enabled: true, hour: 7 }).enabled, true);
});

const at = (h: number, m = 0) => new Date(2026, 5, 23, h, m, 0, 0); // local time

test("briefingDue is false when disabled or before the target hour", () => {
  const cfg: MorningBriefingConfig = { enabled: true, hour: 8 };
  assert.equal(briefingDue({ ...cfg, enabled: false }, at(9)), false);
  assert.equal(briefingDue(cfg, at(7, 59)), false);
});

test("briefingDue fires once at/after the hour, then not again until the next day", () => {
  const cfg: MorningBriefingConfig = { enabled: true, hour: 8 };
  assert.equal(briefingDue(cfg, at(8)), true);               // never run, hour reached
  const ran = { ...cfg, lastRunAt: at(8, 1).toISOString() };
  assert.equal(briefingDue(ran, at(9)), false);              // already ran today
  // next day, before hour → still false; at hour → due again
  const nextEarly = new Date(2026, 5, 24, 7, 0, 0, 0);
  const nextHour = new Date(2026, 5, 24, 8, 0, 0, 0);
  assert.equal(briefingDue(ran, nextEarly), false);
  assert.equal(briefingDue(ran, nextHour), true);
});

test("runBriefingNow pushes via APNs and does not fall back when a device received it", async () => {
  let notified = false;
  const result = await runBriefingNow({
    composeBriefing: async () => "all clear",
    sendPush: async () => ({ sent: 1 }),
    notify: async () => { notified = true; },
  });
  assert.deepEqual({ text: result.text, pushed: result.pushed, fellBack: result.fellBack }, { text: "all clear", pushed: 1, fellBack: false });
  assert.equal(notified, false);
});

test("runBriefingNow falls back to notify() when no device received the push", async () => {
  let notifiedText = "";
  const result = await runBriefingNow({
    composeBriefing: async () => "2 approvals pending",
    sendPush: async () => ({ sent: 0 }),
    notify: async (t) => { notifiedText = t; },
  });
  assert.equal(result.pushed, 0);
  assert.equal(result.fellBack, true);
  assert.match(notifiedText, /2 approvals pending/);
});

test("runBriefingNow falls back when APNs throws", async () => {
  let notified = false;
  const result = await runBriefingNow({
    composeBriefing: async () => "x",
    sendPush: async () => { throw new Error("no apns config"); },
    notify: async () => { notified = true; },
  });
  assert.equal(result.fellBack, true);
  assert.equal(notified, true);
});
