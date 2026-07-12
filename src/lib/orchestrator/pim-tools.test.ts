import test from "node:test";
import assert from "node:assert/strict";
import { parseDuePhrase, extractPimActions, executeCalendarCreate, buildCalendarCreateScript } from "./pim-tools";
import { isPermissionError, permissionNeeded, parsePermissionNeeded } from "./pim-preconditions";

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

// ---------------------------------------------------------------------------
// calendar_create

test("buildCalendarCreateScript: date-component correctness for a fixed parseDuePhrase result", () => {
  const start = parseDuePhrase("friday at noon", NOW)!; // -> July 17 2026, 12:00
  const end = new Date(start.getTime() + 60 * 60_000); // +60 min default
  const script = buildCalendarCreateScript("Lunch with Sam", start, end);

  // Start (d1) components — explicit, never a locale date string.
  assert.match(script, /set year of d1 to 2026/);
  assert.match(script, /set month of d1 to 7/);
  assert.match(script, /set day of d1 to 17/);
  assert.match(script, /set hours of d1 to 12/);
  assert.match(script, /set minutes of d1 to 0/);

  // End (d2) components — one hour later.
  assert.match(script, /set year of d2 to 2026/);
  assert.match(script, /set month of d2 to 7/);
  assert.match(script, /set day of d2 to 17/);
  assert.match(script, /set hours of d2 to 13/);
  assert.match(script, /set minutes of d2 to 0/);

  // Deterministic default-calendar fallback chain + the event itself.
  assert.match(script, /writable of c is true/);
  assert.match(script, /calendar "Home"/);
  assert.match(script, /calendar "Calendar"/);
  assert.match(script, /make new event at end of events of targetCal with properties \{summary:"Lunch with Sam", start date:d1, end date:d2\}/);
  assert.doesNotMatch(script, /as string/); // never a locale date string
});

test("calendar_create: refuses without a title", async () => {
  const out = await executeCalendarCreate({ when: "tomorrow at 2pm" }, { runOsascript: async () => ({ ok: true, out: "OK" }) });
  assert.match(out, /No event title/);
});

test("calendar_create: refuses without a parseable time — never creates an all-day event silently", async () => {
  let called = false;
  const io = { runOsascript: async () => { called = true; return { ok: true, out: "OK" }; } };
  const out = await executeCalendarCreate({ title: "Dentist" }, io);
  assert.match(out, /needs a start time/);
  assert.equal(called, false);

  const out2 = await executeCalendarCreate({ title: "Dentist", when: "someday soon maybe" }, io);
  assert.match(out2, /needs a start time/);
  assert.equal(called, false);
});

test("calendar_create: surfaces an osascript failure", async () => {
  const io = { runOsascript: async () => ({ ok: false, out: "Not authorized to send Apple events to Calendar." }) };
  const out = await executeCalendarCreate({ title: "Dentist", when: "tomorrow at 2pm" }, io);
  assert.match(out, /Could not create the event/);
  assert.match(out, /Not authorized to send Apple events/);
});

test("calendar_create: surfaces an in-script ERROR (no calendar available)", async () => {
  const io = { runOsascript: async () => ({ ok: true, out: "ERROR: no calendar available to create the event in" }) };
  const out = await executeCalendarCreate({ title: "Dentist", when: "tomorrow at 2pm" }, io);
  assert.match(out, /Could not create the event/);
  assert.match(out, /no calendar available/);
});

test("calendar_create: success reply names the title, time, and duration", async () => {
  const io = { runOsascript: async () => ({ ok: true, out: "OK" }) };
  const out = await executeCalendarCreate({ title: "Lunch with Sam", when: "friday at noon", durationMinutes: 30 }, io);
  assert.match(out, /Event created: "Lunch with Sam"/);
  assert.match(out, /30 min/);
});

// ---------------------------------------------------------------------------
// Structured permission-error convention (P0.2)

test("permissionNeeded: exact format, and parsePermissionNeeded round-trips it", () => {
  const s = permissionNeeded("Calendars", "I need access to your calendar — open System Settings, Privacy & Security, Calendars, and enable HiveMatrix.");
  assert.equal(
    s,
    "PERMISSION_NEEDED: Calendars — I need access to your calendar — open System Settings, Privacy & Security, Calendars, and enable HiveMatrix.",
  );
  const parsed = parsePermissionNeeded(s);
  assert.deepEqual(parsed, {
    grant: "Calendars",
    remediation: "I need access to your calendar — open System Settings, Privacy & Security, Calendars, and enable HiveMatrix.",
  });
});

test("permissionNeeded: trims grant and remediation", () => {
  const s = permissionNeeded("  Contacts  ", "  Open Settings.  ");
  assert.equal(s, "PERMISSION_NEEDED: Contacts — Open Settings.");
});

test("parsePermissionNeeded: returns null for a non-matching string", () => {
  assert.equal(parsePermissionNeeded("Could not read the calendar: some error"), null);
  assert.equal(parsePermissionNeeded("Nothing on the calendar today."), null);
  assert.equal(parsePermissionNeeded(""), null);
});

test("isPermissionError: true for representative TCC/osascript denial stderrs", () => {
  assert.equal(isPermissionError("execution error: Not authorized to send Apple events to Calendar. (-1743)"), true);
  assert.equal(isPermissionError("Not authorized to send Apple events to Contacts."), true);
  assert.equal(isPermissionError("execution error: Application isn't running. (-600)"), true);
  assert.equal(isPermissionError("osascript is not allowed assistive access."), true);
  assert.equal(isPermissionError("error: (-1728)"), true);
});

test("isPermissionError: false for unrelated errors", () => {
  assert.equal(isPermissionError("Nothing on the calendar today."), false);
  assert.equal(isPermissionError("syntax error: Expected end of line but found identifier."), false);
  assert.equal(isPermissionError(""), false);
});
