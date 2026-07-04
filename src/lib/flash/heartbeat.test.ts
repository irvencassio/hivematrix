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
  ensureHeartbeatChecklist,
  extractHeartbeatReport,
  heartbeatDue,
  inQuietHours,
  parseHeartbeatConfig,
  runDailyMomentOnce,
  runHeartbeatOnce,
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
  const cfg = { enabled: true, intervalMinutes: 30, morningBriefHour: null, eveningRecapHour: null };
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
    sendApnsPush: async () => ({ sent: 1 }),
    runTurn: async () => ({ reply: "Good morning — approve the release, then we ship.", sessionId: "s1", turnId: "t4" }),
    now: () => at(8),
  });
  assert.equal(viaApns.pushed, 1);
  assert.equal(notified.length, 0);

  const fellBack = await runDailyMomentOnce("evening-recap", {
    notify: async (t) => { notified.push(t); },
    composeStatus: async () => "",
    appendOperatorTurn: (t) => { operatorTurns.push(t); },
    sendApnsPush: async () => ({ sent: 0 }),
    runTurn: async () => ({ reply: "<think>day</think>Shipped two fixes today.", sessionId: "s1", turnId: "t5" }),
    now: () => at(21),
  });
  assert.equal(fellBack.pushed, 0);
  assert.equal(notified.length, 1);
  assert.match(notified[0], /🌙 Evening recap\nShipped two fixes today\./);
  assert.deepEqual(operatorTurns, ["Good morning — approve the release, then we ship.", "Shipped two fixes today."]);
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
