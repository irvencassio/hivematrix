/**
 * Voice prover — /voice/turn "what are my events today" (P0.4).
 *
 * WHY this stubs at the tool layer instead of hitting /voice/turn's HTTP
 * route: that route is a thin alias over the Flash Lane, which spawns a real
 * `claude` model to compose the spoken reply. That call is non-deterministic
 * (model wording varies run to run) and cannot be asserted in a unit test
 * without an LLM in the loop. What IS deterministic — and is what Flash
 * relays to speech verbatim as the tool result — is the `calendar_today`
 * tool executor's output. So this prover stubs the EventKit helper IO
 * (`CalendarHelperIO`) that `executeCalendarToday` calls, and asserts on the
 * exact string that would be spoken: real event titles on the happy path,
 * and the calendar-access remediation sentence on a permission error. This
 * proves the P0 acceptance criteria ("reply contains today's real event
 * titles" / "reply contains the remediation sentence") at the layer the
 * voice turn is actually built from.
 *
 * The real end-to-end path (real DesktopBeeHelper binary) is covered by the
 * gated HIVE_TEST_EVENTKIT=1 test added in P0.3 (pim-tools.test.ts) plus
 * manual smoke of /voice/turn itself.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { executeCalendarToday, type CalendarHelperIO } from "@/lib/orchestrator/pim-tools";
import { parsePermissionNeeded } from "@/lib/orchestrator/pim-preconditions";

function fakeHelperIO(
  run: (binary: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>,
): CalendarHelperIO {
  return {
    resolveBinary: () => "/fake/DesktopBeeHelper",
    run,
  };
}

test("voice prover: events today → reply names each event title", async () => {
  const events = [
    { title: "Board sync", start: "2026-07-11T15:00:00.000Z", end: "2026-07-11T15:30:00.000Z", calendar: "Work", allDay: false },
    { title: "Pick up dry cleaning", start: "2026-07-11T20:00:00.000Z", end: "2026-07-11T20:15:00.000Z", calendar: "Home", allDay: false },
  ];
  const io = fakeHelperIO(async () => ({ code: 0, stdout: JSON.stringify(events), stderr: "" }));

  const reply = await executeCalendarToday({}, io);

  assert.match(reply, /Board sync/, `reply should contain "Board sync": ${reply}`);
  assert.match(reply, /Pick up dry cleaning/, `reply should contain "Pick up dry cleaning": ${reply}`);
});

test("voice prover: calendar permission missing → reply speaks the remediation", async () => {
  const io = fakeHelperIO(async () => ({ code: 77, stdout: '{"error":"permission"}', stderr: "" }));

  const reply = await executeCalendarToday({}, io);

  const parsed = parsePermissionNeeded(reply);
  assert.ok(parsed, `expected a parseable permissionNeeded reply, got: ${reply}`);
  assert.equal(parsed!.grant, "Calendars");
  assert.match(
    parsed!.remediation.toLowerCase(),
    /calendar/,
    `remediation sentence should mention calendar access: ${parsed!.remediation}`,
  );
});

test("voice prover: empty calendar → honest nothing-scheduled reply", async () => {
  const io = fakeHelperIO(async () => ({ code: 0, stdout: "[]", stderr: "" }));

  const reply = await executeCalendarToday({}, io);

  assert.match(reply, /Nothing on the calendar today\./, `reply should be the honest empty message: ${reply}`);
});
