import test from "node:test";
import assert from "node:assert/strict";
import {
  pickDueReminders,
  reminderKey,
  checkDueRemindersAndNotify,
  type DueReminder,
  type ReminderNotifyState,
} from "./reminder-notify";

const at = (iso: string): Date => new Date(iso);

test("pickDueReminders: only reminders that crossed due within (lastCheck, now]", () => {
  const reminders: DueReminder[] = [
    { title: "call the dentist", due: "2026-07-12T14:20:00Z" }, // in window
    { title: "future thing", due: "2026-07-12T15:00:00Z" },     // still future
    { title: "already passed", due: "2026-07-12T14:00:00Z" },   // before watermark
    { title: "no due", due: null },                              // skipped
    { title: "garbage due", due: "not-a-date" },                 // skipped
  ];
  const got = pickDueReminders(reminders, at("2026-07-12T14:10:00Z"), at("2026-07-12T14:30:00Z"), new Set());
  assert.deepEqual(got.map((r) => r.title), ["call the dentist"]);
});

test("pickDueReminders: an already-notified reminder is not repeated", () => {
  const reminders: DueReminder[] = [{ title: "stretch", due: "2026-07-12T14:20:00Z" }];
  const notified = new Set([reminderKey(reminders[0])]);
  const got = pickDueReminders(reminders, at("2026-07-12T14:10:00Z"), at("2026-07-12T14:30:00Z"), notified);
  assert.equal(got.length, 0);
});

test("checkDueRemindersAndNotify: texts due reminders once and advances the watermark", async () => {
  let state: ReminderNotifyState = { lastCheckIso: "2026-07-12T14:10:00Z", notified: [] };
  const sent: string[] = [];
  const deps = {
    now: () => at("2026-07-12T14:30:00Z"),
    listReminders: async (): Promise<DueReminder[]> => [
      { title: "call the dentist", due: "2026-07-12T14:20:00Z" },
      { title: "future", due: "2026-07-12T20:00:00Z" },
    ],
    notify: async (text: string) => { sent.push(text); },
    loadState: () => state,
    saveState: (s: ReminderNotifyState) => { state = s; },
  };

  const n = await checkDueRemindersAndNotify(deps);
  assert.equal(n, 1);
  assert.deepEqual(sent, ["⏰ Reminder: call the dentist"]);
  assert.equal(state.lastCheckIso, "2026-07-12T14:30:00.000Z");
  assert.ok(state.notified.some((k) => k.startsWith("call the dentist")));

  // Second pass at the same instant: nothing new fires.
  const n2 = await checkDueRemindersAndNotify(deps);
  assert.equal(n2, 0);
  assert.equal(sent.length, 1);
});

test("checkDueRemindersAndNotify: first run (no watermark) never back-blasts overdue reminders", async () => {
  let state: ReminderNotifyState = { lastCheckIso: null, notified: [] };
  const sent: string[] = [];
  const deps = {
    now: () => at("2026-07-12T14:30:00Z"),
    listReminders: async (): Promise<DueReminder[]> => [
      { title: "long overdue", due: "2026-07-01T00:00:00Z" },
    ],
    notify: async (text: string) => { sent.push(text); },
    loadState: () => state,
    saveState: (s: ReminderNotifyState) => { state = s; },
  };
  const n = await checkDueRemindersAndNotify(deps);
  assert.equal(n, 0);
  assert.equal(sent.length, 0);
  assert.equal(state.lastCheckIso, "2026-07-12T14:30:00.000Z"); // watermark set
});

test("checkDueRemindersAndNotify: a helper failure advances the watermark and alerts nothing", async () => {
  let state: ReminderNotifyState = { lastCheckIso: "2026-07-12T14:10:00Z", notified: [] };
  const sent: string[] = [];
  const deps = {
    now: () => at("2026-07-12T14:30:00Z"),
    listReminders: async (): Promise<DueReminder[]> => { throw new Error("helper down"); },
    notify: async (text: string) => { sent.push(text); },
    loadState: () => state,
    saveState: (s: ReminderNotifyState) => { state = s; },
  };
  const n = await checkDueRemindersAndNotify(deps);
  assert.equal(n, 0);
  assert.equal(sent.length, 0);
  assert.equal(state.lastCheckIso, "2026-07-12T14:30:00.000Z");
});
