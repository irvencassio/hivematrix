import assert from "node:assert/strict";
import test from "node:test";

import { canControlMail, parseSender, parseMailRecords, _setAppleMailDepsForTests } from "./applemail";

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
