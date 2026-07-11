import test from "node:test";
import assert from "node:assert/strict";
import { parseDuePhrase, extractPimActions } from "./pim-tools";

// Fixed reference: Friday July 10 2026, 2:00 PM local.
const NOW = new Date(2026, 6, 10, 14, 0, 0);

test("parseDuePhrase: relative 'in N minutes/hours/days'", () => {
  assert.equal(parseDuePhrase("in 20 minutes", NOW)!.getTime(), NOW.getTime() + 20 * 60_000);
  assert.equal(parseDuePhrase("in 2 hours", NOW)!.getTime(), NOW.getTime() + 2 * 3_600_000);
  assert.equal(parseDuePhrase("in a day", NOW)!.getTime(), NOW.getTime() + 86_400_000);
});

test("parseDuePhrase: 'tomorrow at 5pm' and bare 'tomorrow' (9 AM default)", () => {
  const t5 = parseDuePhrase("tomorrow at 5pm", NOW)!;
  assert.deepEqual([t5.getDate(), t5.getHours(), t5.getMinutes()], [11, 17, 0]);
  const t9 = parseDuePhrase("tomorrow", NOW)!;
  assert.deepEqual([t9.getDate(), t9.getHours()], [11, 9]);
});

test("parseDuePhrase: bare 'at 5' spoken at 2 PM means 5 PM today", () => {
  const d = parseDuePhrase("at 5", NOW)!;
  assert.deepEqual([d.getDate(), d.getHours()], [10, 17]);
});

test("parseDuePhrase: past time with no explicit day rolls to tomorrow", () => {
  const d = parseDuePhrase("at 1pm", NOW)!; // 1 PM already passed at 2 PM
  assert.deepEqual([d.getDate(), d.getHours()], [11, 13]);
});

test("parseDuePhrase: weekday name is the NEXT such day (never today)", () => {
  const fri = parseDuePhrase("friday at noon", NOW)!; // NOW is a Friday
  assert.deepEqual([fri.getDate(), fri.getHours()], [17, 12]);
  const mon = parseDuePhrase("monday morning", NOW)!;
  assert.deepEqual([mon.getDate(), mon.getHours()], [13, 9]);
});

test("parseDuePhrase: dayparts and unparseable input", () => {
  assert.equal(parseDuePhrase("tonight", NOW)!.getHours(), 20);
  assert.equal(parseDuePhrase("", NOW), null);
  assert.equal(parseDuePhrase("someday soon maybe", NOW), null);
});

test("extractPimActions: contact output becomes labeled dial+sms actions", () => {
  const out = "John Smith\n  phone: (513) 555-1234\n  email: js@x.com\n";
  const actions = extractPimActions([{ name: "contacts_lookup", output: out }]);
  assert.deepEqual(actions, [
    { type: "dial", label: "Call John Smith", number: "+15135551234" },
    { type: "sms", label: "Text John Smith", number: "+15135551234" },
  ]);
});

test("extractPimActions: dedupes, caps, and reads numbers from the reply text", () => {
  const actions = extractPimActions([], "You can reach the office at 513-555-9999.");
  assert.deepEqual(actions, [{ type: "dial", label: "Call this number", number: "+15135559999" }]);
  // Same number in tool output and reply → deduped dial.
  const both = extractPimActions(
    [{ name: "get_contact", output: "Ann\n  phone: 513 555 9999\n" }],
    "Ann's number is 513-555-9999.",
  );
  assert.equal(both.filter((a) => a.type === "dial").length, 1);
});

test("extractPimActions: ignores non-contact tools and short digit runs", () => {
  assert.deepEqual(extractPimActions([{ name: "calendar_today", output: "Standup — 9:30 AM" }], "Your standup is at 9:30."), []);
});
