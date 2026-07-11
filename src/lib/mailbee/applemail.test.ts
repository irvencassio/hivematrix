import assert from "node:assert/strict";
import test from "node:test";

import { canControlMail, probeAppleMail, parseSender, parseMailRecords, _setAppleMailDepsForTests } from "./applemail";

test("parseSender splits name + address and lowercases", () => {
  assert.deepEqual(parseSender("Bob Smith <Bob@Acme.com>"), { from: "bob@acme.com", fromName: "Bob Smith" });
  assert.deepEqual(parseSender("plain@x.com"), { from: "plain@x.com", fromName: null });
  assert.deepEqual(parseSender('"Quoted Name" <q@x.com>'), { from: "q@x.com", fromName: "Quoted Name" });
});

test("parseMailRecords parses RS/US-delimited osascript output", () => {
  const US = "\x1f", RS = "\x1e";
  const raw =
    ["101", "Bob <bob@acme.com>", "Q3 numbers", "Thursday, June 12, 2026", "deck.pdf,", "Please review."].join(US) + RS +
    ["102", "noreply@news.com", "Weekly digest", "Friday, June 13, 2026", "", "Top stories…"].join(US) + RS;
  const out = parseMailRecords(raw);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 101);
  assert.equal(out[0].from, "bob@acme.com");
  assert.equal(out[0].fromName, "Bob");
  assert.equal(out[0].subject, "Q3 numbers");
  assert.deepEqual(out[0].attachments, ["deck.pdf"]);
  assert.equal(out[0].body, "Please review.");
  assert.equal(out[1].id, 102);
  assert.deepEqual(out[1].attachments, []);
});

test("parseMailRecords skips blank/garbage records", () => {
  assert.deepEqual(parseMailRecords(""), []);
  assert.deepEqual(parseMailRecords("\x1e\x1e"), []);
  assert.deepEqual(parseMailRecords("notanumber\x1fx\x1fy\x1fz\x1f\x1fbody\x1e"), []);
});

test("canControlMail does not run Mail AppleScript when Mail is closed", async (t) => {
  let scriptCalls = 0;
  _setAppleMailDepsForTests({
    isMailAppRunning: () => false,
    osascript: async () => {
      scriptCalls++;
      return { ok: true, stdout: "" };
    },
  });
  t.after(() => _setAppleMailDepsForTests(null));

  assert.equal(await canControlMail(), false);
  assert.equal(scriptCalls, 0);
});

test("canControlMail can explicitly allow a launch-capable setup probe", async (t) => {
  let scriptCalls = 0;
  _setAppleMailDepsForTests({
    isMailAppRunning: () => false,
    osascript: async () => {
      scriptCalls++;
      return { ok: true, stdout: "" };
    },
  });
  t.after(() => _setAppleMailDepsForTests(null));

  assert.equal(await canControlMail(8_000, { allowLaunch: true }), true);
  assert.equal(scriptCalls, 1);
});

// probeAppleMail distinguishes WHY control failed instead of a bare boolean —
// the guided Mail Lane setup dialog needs the real reason (not authorized vs.
// not running vs. timed out) to show something better than a generic
// "approval needed" dead end, and to know when to launch-and-retry vs. just
// tell the user to approve a pending prompt.
test("probeAppleMail reports not_running without invoking osascript when Mail isn't open and launch isn't allowed", async (t) => {
  let scriptCalls = 0;
  _setAppleMailDepsForTests({
    isMailAppRunning: () => false,
    osascript: async () => { scriptCalls++; return { ok: true, stdout: "" }; },
  });
  t.after(() => _setAppleMailDepsForTests(null));

  const result = await probeAppleMail();
  assert.equal(result.ok, false);
  assert.equal(result.kind, "not_running");
  assert.equal(scriptCalls, 0);
});

test("probeAppleMail classifies a TCC/Automation denial (-1743) as not_authorized", async (t) => {
  _setAppleMailDepsForTests({
    isMailAppRunning: () => true,
    osascript: async () => ({
      ok: false,
      stdout: "",
      stderr: "execution error: Not authorized to send Apple events to Mail. (-1743)",
    }),
  });
  t.after(() => _setAppleMailDepsForTests(null));

  const result = await probeAppleMail(8_000, { allowLaunch: true });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "not_authorized");
  assert.match(result.detail, /approve/i);
  // canControlMail keeps its boolean contract for existing callers.
  assert.equal(await canControlMail(8_000, { allowLaunch: true }), false);
});

test("probeAppleMail classifies 'application isn't running' (-600) as not_running even with allowLaunch", async (t) => {
  _setAppleMailDepsForTests({
    isMailAppRunning: () => true,
    osascript: async () => ({
      ok: false,
      stdout: "",
      stderr: "Mail got an error: Application isn't running. (-600)",
    }),
  });
  t.after(() => _setAppleMailDepsForTests(null));

  const result = await probeAppleMail(8_000, { allowLaunch: true });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "not_running");
});

test("probeAppleMail classifies an execFile timeout kill as timeout, not a generic error", async (t) => {
  _setAppleMailDepsForTests({
    isMailAppRunning: () => true,
    osascript: async () => ({ ok: false, stdout: "", stderr: "", timedOut: true }),
  });
  t.after(() => _setAppleMailDepsForTests(null));

  const result = await probeAppleMail(8_000, { allowLaunch: true });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "timeout");
});

test("probeAppleMail falls back to a generic error kind for an unrecognized AppleScript failure", async (t) => {
  _setAppleMailDepsForTests({
    isMailAppRunning: () => true,
    osascript: async () => ({ ok: false, stdout: "", stderr: "some other AppleScript failure" }),
  });
  t.after(() => _setAppleMailDepsForTests(null));

  const result = await probeAppleMail(8_000, { allowLaunch: true });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "error");
  assert.match(result.detail, /some other AppleScript failure/);
});

test("probeAppleMail reports granted on success", async (t) => {
  _setAppleMailDepsForTests({
    isMailAppRunning: () => true,
    osascript: async () => ({ ok: true, stdout: "3" }),
  });
  t.after(() => _setAppleMailDepsForTests(null));

  const result = await probeAppleMail(8_000, { allowLaunch: true });
  assert.deepEqual(result, { ok: true, kind: "granted", detail: "HiveMatrix can control Apple Mail." });
});
