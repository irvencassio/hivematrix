import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-heartbeat-test-"));
const ORIGINAL_HOME = process.env.HOME;
process.env.HOME = TMP;

const {
  HEARTBEAT_STAND_DOWN,
  buildDailyMomentPrompt,
  buildHeartbeatPrompt,
  dailyMomentDue,
  dayBriefMomentDue,
  ensureHeartbeatChecklist,
  extractHeartbeatReport,
  heartbeatDue,
  inQuietHours,
  localDateString,
  parseHeartbeatConfig,
  runDailyMomentOnce,
  runDayBriefRitualOnce,
  runHeartbeatOnce,
  weekKey,
  weeklyMomentDue,
  runRatchetOnce,
  runWeaverOnce,
} = await import("./heartbeat");

test.after(() => {
  if (ORIGINAL_HOME) process.env.HOME = ORIGINAL_HOME;
  rmSync(TMP, { recursive: true, force: true });
});

test("parseHeartbeatConfig defaults + clamping", () => {
  assert.deepEqual(parseHeartbeatConfig(undefined), {
    enabled: false,
    intervalMinutes: 30,
    morningBriefHour: 8,
    eveningRecapHour: 21,
    dayBriefEnabled: false,
    dayBriefMorningHour: 7,
    dayBriefMorningMinute: 30,
    dayBriefEveningHour: 21,
    dayBriefEveningMinute: 0,
    ratchetEnabled: false,
    ratchetHour: 18,
    ratchetMinute: 0,
    weaverEnabled: false,
    weaverHour: 17,
    weaverMinute: 0,
  });
  assert.equal(parseHeartbeatConfig({ intervalMinutes: 1 }).intervalMinutes, 5); // floor at 5
  assert.equal(parseHeartbeatConfig({ enabled: true }).enabled, true);
  // Quiet hours: kept when valid, dropped when degenerate
  assert.deepEqual(parseHeartbeatConfig({ quietHours: { startHour: 22, endHour: 7 } }).quietHours, { startHour: 22, endHour: 7 });
  assert.equal(parseHeartbeatConfig({ quietHours: { startHour: 8, endHour: 8 } }).quietHours, undefined);
  assert.equal(parseHeartbeatConfig({ quietHours: { startHour: "x", endHour: 7 } }).quietHours, undefined);
  // Daily moments: null disables, invalid falls back to defaults, valid hours clamp
  assert.equal(parseHeartbeatConfig({ morningBriefHour: null }).morningBriefHour, null);
  assert.equal(parseHeartbeatConfig({ morningBriefHour: "x" }).morningBriefHour, 8);
  assert.equal(parseHeartbeatConfig({ eveningRecapHour: 99 }).eveningRecapHour, 23);
});

test("parseHeartbeatConfig: Day Brief ritual defaults off with 07:30/21:00, clamps minutes/hours", () => {
  assert.equal(parseHeartbeatConfig({}).dayBriefEnabled, false);
  assert.equal(parseHeartbeatConfig({ dayBriefEnabled: true }).dayBriefEnabled, true);
  assert.equal(parseHeartbeatConfig({ dayBriefMorningMinute: 99 }).dayBriefMorningMinute, 59);
  assert.equal(parseHeartbeatConfig({ dayBriefMorningMinute: "x" }).dayBriefMorningMinute, 30);
  assert.equal(parseHeartbeatConfig({ dayBriefEveningHour: 99 }).dayBriefEveningHour, 23);
  assert.equal(
    parseHeartbeatConfig({ lastDayBriefMorningSentDay: "2026-07-09" }).lastDayBriefMorningSentDay,
    "2026-07-09",
  );
});

test("parseHeartbeatConfig: Capability Ratchet + Weaver Audit default off with 18:00/17:00, clamp + passthrough lastSentWeek", () => {
  assert.equal(parseHeartbeatConfig({}).ratchetEnabled, false);
  assert.equal(parseHeartbeatConfig({}).ratchetHour, 18);
  assert.equal(parseHeartbeatConfig({}).ratchetMinute, 0);
  assert.equal(parseHeartbeatConfig({}).weaverEnabled, false);
  assert.equal(parseHeartbeatConfig({}).weaverHour, 17);
  assert.equal(parseHeartbeatConfig({}).weaverMinute, 0);
  assert.equal(parseHeartbeatConfig({ ratchetEnabled: true }).ratchetEnabled, true);
  assert.equal(parseHeartbeatConfig({ weaverEnabled: true }).weaverEnabled, true);
  assert.equal(parseHeartbeatConfig({ ratchetHour: 99 }).ratchetHour, 23);
  assert.equal(parseHeartbeatConfig({ ratchetHour: "x" }).ratchetHour, 18);
  assert.equal(parseHeartbeatConfig({ weaverMinute: 99 }).weaverMinute, 59);
  assert.equal(parseHeartbeatConfig({ lastRatchetSentWeek: "2026-W27" }).lastRatchetSentWeek, "2026-W27");
  assert.equal(parseHeartbeatConfig({ lastWeaverSentWeek: "2026-W28" }).lastWeaverSentWeek, "2026-W28");
});

const at = (h: number, m = 0) => new Date(2026, 6, 4, h, m, 0, 0); // local time

test("inQuietHours handles plain and midnight-wrapped windows", () => {
  assert.equal(inQuietHours({ startHour: 9, endHour: 17 }, at(12)), true);
  assert.equal(inQuietHours({ startHour: 9, endHour: 17 }, at(8)), false);
  assert.equal(inQuietHours({ startHour: 22, endHour: 7 }, at(23)), true);
  assert.equal(inQuietHours({ startHour: 22, endHour: 7 }, at(3)), true);
  assert.equal(inQuietHours({ startHour: 22, endHour: 7 }, at(12)), false);
  assert.equal(inQuietHours(undefined, at(3)), false);
});

test("heartbeatDue: disabled/quiet/interval gating", () => {
  const cfg = {
    enabled: true, intervalMinutes: 30, morningBriefHour: null, eveningRecapHour: null,
    dayBriefEnabled: false, dayBriefMorningHour: 7, dayBriefMorningMinute: 30, dayBriefEveningHour: 21, dayBriefEveningMinute: 0,
    ratchetEnabled: false, ratchetHour: 18, ratchetMinute: 0,
    weaverEnabled: false, weaverHour: 17, weaverMinute: 0,
  };
  assert.equal(heartbeatDue({ ...cfg, enabled: false }, at(10)), false);
  assert.equal(heartbeatDue(cfg, at(10)), true); // never ran
  const ran = { ...cfg, lastRunAt: at(10).toISOString() };
  assert.equal(heartbeatDue(ran, at(10, 15)), false); // 15 min < 30 min
  assert.equal(heartbeatDue(ran, at(10, 30)), true);  // interval elapsed
  const quiet = { ...cfg, quietHours: { startHour: 22, endHour: 7 } };
  assert.equal(heartbeatDue(quiet, at(23)), false);
});

test("extractHeartbeatReport: stand-down token and think-block stripping", () => {
  assert.equal(extractHeartbeatReport(HEARTBEAT_STAND_DOWN), null);
  assert.equal(extractHeartbeatReport(`  ${HEARTBEAT_STAND_DOWN}\n`), null);
  assert.equal(extractHeartbeatReport("<think>hmm nothing</think>HEARTBEAT_STAND_DOWN"), null);
  assert.equal(extractHeartbeatReport(""), null);
  assert.equal(extractHeartbeatReport("<think>reason</think>Task X failed twice — I filed a fix task."), "Task X failed twice — I filed a fix task.");
});

test("ensureHeartbeatChecklist seeds a default once and then reads back edits", () => {
  const root = join(TMP, "brain-seed");
  const first = ensureHeartbeatChecklist(root);
  assert.match(first, /Heartbeat checklist/);
  assert.equal(existsSync(join(root, "persona", "HEARTBEAT.md")), true);
  writeFileSync(join(root, "persona", "HEARTBEAT.md"), "# Mine\n- watch the deploy\n", "utf-8");
  assert.match(ensureHeartbeatChecklist(root), /watch the deploy/);
  // Re-seeding must not clobber the operator's edit
  assert.match(readFileSync(join(root, "persona", "HEARTBEAT.md"), "utf-8"), /watch the deploy/);
});

test("buildHeartbeatPrompt embeds checklist, snapshot, autonomy guidance, and the stand-down rule", () => {
  const prompt = buildHeartbeatPrompt({
    checklist: "- check approvals",
    statusSnapshot: "2 approvals pending",
    autonomy: "autonomous",
    now: at(9),
  });
  assert.match(prompt, /check approvals/);
  assert.match(prompt, /2 approvals pending/);
  assert.match(prompt, /AUTONOMOUS: act on what is genuinely useful without asking first/);
  assert.match(prompt, new RegExp(HEARTBEAT_STAND_DOWN));
  const manual = buildHeartbeatPrompt({ checklist: "x", statusSnapshot: "", autonomy: "manual", now: at(9) });
  assert.match(manual, /MANUAL: observe and report only/);
});

test("runHeartbeatOnce: stand-down produces no notify and no operator turn", async () => {
  mkdirSync(join(TMP, ".hivematrix"), { recursive: true });
  const notified: string[] = [];
  const operatorTurns: string[] = [];
  const result = await runHeartbeatOnce({
    notify: async (t) => { notified.push(t); },
    composeStatus: async () => "all quiet",
    appendOperatorTurn: (t) => { operatorTurns.push(t); },
    runTurn: async () => ({ reply: HEARTBEAT_STAND_DOWN, sessionId: "s1", turnId: "t1" }),
    now: () => at(9),
  });
  assert.deepEqual({ ran: result.ran, stoodDown: result.stoodDown, report: result.report }, { ran: true, stoodDown: true, report: null });
  assert.equal(notified.length, 0);
  assert.equal(operatorTurns.length, 0);
});

test("runHeartbeatOnce: a report notifies AND lands as an operator turn; prompt carries the snapshot", async () => {
  const notified: string[] = [];
  const operatorTurns: string[] = [];
  let seenPrompt = "";
  const result = await runHeartbeatOnce({
    notify: async (t) => { notified.push(t); },
    composeStatus: async () => "1 task failed overnight",
    appendOperatorTurn: (t) => { operatorTurns.push(t); },
    runTurn: async (opts) => {
      seenPrompt = opts.text;
      return { reply: "The nightly build failed twice; I retried it and it is green now.", sessionId: "s1", turnId: "t2" };
    },
    now: () => at(9),
  });
  assert.equal(result.stoodDown, false);
  assert.match(result.report ?? "", /green now/);
  assert.equal(notified.length, 1);
  assert.match(notified[0], /^💓 /);
  assert.deepEqual(operatorTurns, ["The nightly build failed twice; I retried it and it is green now."]);
  assert.match(seenPrompt, /1 task failed overnight/);
  assert.match(seenPrompt, /Heartbeat/);
});

test("dailyMomentDue: fires once at/after the hour, again the next day; null disables", () => {
  assert.equal(dailyMomentDue(null, undefined, at(9)), false);
  assert.equal(dailyMomentDue(8, undefined, at(7, 59)), false);
  assert.equal(dailyMomentDue(8, undefined, at(8)), true);
  const ranAt = at(8, 1).toISOString();
  assert.equal(dailyMomentDue(8, ranAt, at(15)), false); // already ran today
  const nextDay = new Date(2026, 6, 5, 8, 0, 0, 0);
  assert.equal(dailyMomentDue(8, ranAt, nextDay), true);
});

test("localDateString: local YYYY-MM-DD, zero-padded", () => {
  assert.equal(localDateString(at(9)), "2026-07-04");
  assert.equal(localDateString(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("dayBriefMomentDue: fires once at/after hour:minute, again the next day; already-sent-today blocks it", () => {
  assert.equal(dayBriefMomentDue(7, 30, undefined, at(7, 29)), false);
  assert.equal(dayBriefMomentDue(7, 30, undefined, at(7, 30)), true);
  assert.equal(dayBriefMomentDue(7, 30, undefined, at(9)), true); // still due later the same day if never sent
  const today = localDateString(at(7, 30));
  assert.equal(dayBriefMomentDue(7, 30, today, at(9)), false); // already sent today
  const nextDay = new Date(2026, 6, 5, 7, 30, 0, 0);
  assert.equal(dayBriefMomentDue(7, 30, today, nextDay), true); // new day, due again
});

test("weekKey: same week for any day Mon-Sun, different across a week boundary, YYYY-Www format", () => {
  const sunday = new Date(2026, 6, 5); // 2026-07-05 is a Sunday
  const mondayBefore = new Date(2026, 5, 29); // the Monday that starts that same ISO week
  assert.equal(weekKey(sunday), weekKey(mondayBefore));
  const nextSunday = new Date(2026, 6, 12);
  assert.notEqual(weekKey(sunday), weekKey(nextSunday));
  assert.match(weekKey(sunday), /^\d{4}-W\d{2}$/);
});

test("weeklyMomentDue: fires once on the target weekday at/after hour:minute, blocked once sent this week, due again next week", () => {
  const sunday = (h: number, m = 0) => new Date(2026, 6, 5, h, m, 0, 0); // Sunday
  const saturday = new Date(2026, 6, 4, 20, 0, 0, 0); // wrong weekday, well past the hour

  assert.equal(weeklyMomentDue(0, 18, 0, undefined, saturday), false); // not Sunday
  assert.equal(weeklyMomentDue(0, 18, 0, undefined, sunday(17, 59)), false); // Sunday, before 18:00
  assert.equal(weeklyMomentDue(0, 18, 0, undefined, sunday(18, 0)), true); // Sunday, at 18:00
  assert.equal(weeklyMomentDue(0, 18, 0, undefined, sunday(20, 0)), true); // still due later the same day if never sent

  const thisWeek = weekKey(sunday(18));
  assert.equal(weeklyMomentDue(0, 18, 0, thisWeek, sunday(20)), false); // already sent this week

  const nextSunday = new Date(2026, 6, 12, 18, 0, 0, 0);
  assert.equal(weeklyMomentDue(0, 18, 0, thisWeek, nextSunday), true); // new week, due again
});

test("buildDailyMomentPrompt: morning asks for the one decision; evening asks for the day's story", () => {
  const morning = buildDailyMomentPrompt({ moment: "morning-brief", statusSnapshot: "3 tasks done", now: at(8) });
  assert.match(morning, /Morning brief/);
  assert.match(morning, /ONE decision/);
  assert.match(morning, /3 tasks done/);
  const evening = buildDailyMomentPrompt({ moment: "evening-recap", statusSnapshot: "", now: at(21) });
  assert.match(evening, /Evening recap/);
  assert.match(evening, /what you did for them today/i);
});

test("runDailyMomentOnce: APNs success skips notify; failure falls back; operator turn always lands", async () => {
  const notified: string[] = [];
  const operatorTurns: string[] = [];
  const viaApns = await runDailyMomentOnce("morning-brief", {
    notify: async (t) => { notified.push(t); },
    composeStatus: async () => "2 approvals pending",
    appendOperatorTurn: (t) => { operatorTurns.push(t); },
    sendPush: async () => ({ sent: 1 }),
    runTurn: async () => ({ reply: "Good morning — approve the release, then we ship.", sessionId: "s1", turnId: "t4" }),
    now: () => at(8),
  });
  assert.equal(viaApns.pushed, 1);
  assert.equal(notified.length, 0);

  const fellBack = await runDailyMomentOnce("evening-recap", {
    notify: async (t) => { notified.push(t); },
    composeStatus: async () => "",
    appendOperatorTurn: (t) => { operatorTurns.push(t); },
    sendPush: async () => ({ sent: 0 }),
    runTurn: async () => ({ reply: "<think>day</think>Shipped two fixes today.", sessionId: "s1", turnId: "t5" }),
    now: () => at(21),
  });
  assert.equal(fellBack.pushed, 0);
  assert.equal(notified.length, 1);
  assert.match(notified[0], /🌙 Evening recap\nShipped two fixes today\./);
  assert.deepEqual(operatorTurns, ["Good morning — approve the release, then we ship.", "Shipped two fixes today."]);
});

test("runDayBriefRitualOnce: sends composeDayBrief's text via notify and marks the day sent (no APNs, no operator turn)", async () => {
  const notified: string[] = [];
  const seenKinds: string[] = [];
  const result = await runDayBriefRitualOnce("morning", {
    notify: async (t) => { notified.push(t); },
    composeDayBrief: async (kind) => { seenKinds.push(kind); return "No meetings today.\nNo reminders due."; },
    now: () => at(7, 30),
  });
  assert.equal(result.text, "No meetings today.\nNo reminders due.");
  assert.deepEqual(notified, ["No meetings today.\nNo reminders due."]);
  assert.deepEqual(seenKinds, ["morning"]);
});

test("runDayBriefRitualOnce survives a failing notify channel and still returns the composed text", async () => {
  const result = await runDayBriefRitualOnce("evening", {
    notify: async () => { throw new Error("imessage down"); },
    composeDayBrief: async () => "Nothing shipped today.",
    now: () => at(21),
  });
  assert.equal(result.text, "Nothing shipped today.");
});

test("runRatchetOnce: notifies with runRatchetPass's notify text when a proposal was created", async () => {
  const notified: string[] = [];
  const result = await runRatchetOnce({
    notify: async (t) => { notified.push(t); },
    runRatchetPass: async () => ({ created: true, notifyText: "line one\nline two", taskId: "t1" }),
  });
  assert.deepEqual(result, { created: true, notifyText: "line one\nline two", taskId: "t1" });
  assert.deepEqual(notified, ["line one\nline two"]);
});

test("runRatchetOnce: zero-escalation no-op sends no notify at all", async () => {
  const notified: string[] = [];
  const result = await runRatchetOnce({
    notify: async (t) => { notified.push(t); },
    runRatchetPass: async () => ({ created: false, notifyText: null }),
  });
  assert.equal(result.created, false);
  assert.equal(notified.length, 0);
});

test("runRatchetOnce survives a failing notify channel and still returns the pass result", async () => {
  const result = await runRatchetOnce({
    notify: async () => { throw new Error("imessage down"); },
    runRatchetPass: async () => ({ created: true, notifyText: "line one\nline two", taskId: "t2" }),
  });
  assert.equal(result.created, true);
  assert.equal(result.taskId, "t2");
});

test("runWeaverOnce: notifies composeWeaverAudit's text prefixed '🌀 Weaver weekly:'", async () => {
  const notified: string[] = [];
  const result = await runWeaverOnce({
    notify: async (t) => { notified.push(t); },
    composeWeaverAudit: async () => "What moved: shipped X.\nWhy haven't you started Y?",
  });
  assert.equal(result.text, "What moved: shipped X.\nWhy haven't you started Y?");
  assert.deepEqual(notified, ["🌀 Weaver weekly:\nWhat moved: shipped X.\nWhy haven't you started Y?"]);
});

test("runWeaverOnce: a null audit (no signal / model failure) sends NOTHING", async () => {
  const notified: string[] = [];
  const result = await runWeaverOnce({
    notify: async (t) => { notified.push(t); },
    composeWeaverAudit: async () => null,
  });
  assert.equal(result.text, null);
  assert.equal(notified.length, 0);
});

test("runWeaverOnce survives a failing notify channel and still returns the audit text", async () => {
  const result = await runWeaverOnce({
    notify: async () => { throw new Error("imessage down"); },
    composeWeaverAudit: async () => "some audit text",
  });
  assert.equal(result.text, "some audit text");
});

test("runHeartbeatOnce survives a failing notify channel", async () => {
  const result = await runHeartbeatOnce({
    notify: async () => { throw new Error("telegram down"); },
    composeStatus: async () => "",
    appendOperatorTurn: () => {},
    runTurn: async () => ({ reply: "report text", sessionId: "s1", turnId: "t3" }),
    now: () => at(9),
  });
  assert.equal(result.report, "report text");
});
