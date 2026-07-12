# calendar_today misdiagnoses a stale helper as PERMISSION_NEEDED — Design

## Symptom

Operator has granted HiveMatrix "Full Access" under System Settings ▸ Privacy &
Security ▸ Calendars. `calendar_today` still returns
`PERMISSION_NEEDED: Calendars — ...` (the `CalendarsPromptPending` remediation
text specifically).

## Investigation

Reproduced directly against the installed helper:

```
/Applications/HiveMatrix.app/Contents/Resources/DesktopBeeHelper.app/Contents/MacOS/DesktopBeeHelper calendar today --limit 3
```

This did **not** run the calendar subcommand at all — it printed
`[desktopbee-helper] listening on 127.0.0.1:3748` (the normal daemon startup
line from `main.swift`'s `LoopbackServer`) and hung until killed.

Root cause, confirmed empirically (`strings` on both binaries, `cmp`, and a
manual `swift build -c release`):

1. `Calendar.swift` (EventKit `calendar` CLI subcommand, commits 2c5dee8f
   through 49a26f7f) exists in source and is referenced from `main.swift`'s
   `if cliArgs.first == "calendar" { CalendarCLI.run(...) }` dispatch.
2. The **compiled** `desktopbee-helper/.build/release/DesktopBeeHelper` binary
   — both in the dev tree and inside the installed
   `/Applications/HiveMatrix.app` — predates that feature entirely. `strings`
   showed zero references to `CalendarCLI`, `requestFullAccessToEvents`, or
   the calendar usage strings, in either copy, before I manually reran
   `swift build -c release`. The assembled `.app`'s `Info.plist` was
   similarly stale (missing `NSCalendarsFullAccessUsageDescription`,
   `LSMinimumSystemVersion` still `12.0`).
3. Why: `desktopbee-helper/build-app.sh` (which runs `swift build`, reassembles
   `DesktopBeeHelper.app`, and re-signs it from `Resources/Info.plist`) is a
   **manual, standalone script**. The top-level `scripts/build-app.sh` never
   calls it — it only re-signs whatever `desktopbee-helper/DesktopBeeHelper.app`
   already happens to be sitting on disk (`sign-bundled-machos.sh`). Nothing
   in the packaging pipeline rebuilds the helper from current source. Someone
   added the calendar feature to source/git without re-running the helper's
   own build script, then packaged and installed a release — silently
   shipping the pre-calendar-feature helper binary.
4. Effect at the call site (`pim-tools.ts` `executeCalendarToday` →
   `runDesktopBeeHelper`): the stale binary doesn't recognize `["calendar",
   "today", ...]` as anything special, falls through to its normal daemon
   bootstrap, and never exits. Node's `execFile` 15s timeout fires
   (`err.killed === true`, non-numeric `err.code`), which the existing code
   maps to `HELPER_TIMEOUT_CODE` (124) — a code path whose *only* existing
   interpretation is "the OS TCC consent dialog is blocking the process,
   pending human approval" (`REMEDIATION.CalendarsPromptPending`). That
   interpretation was reasonable for the scenario it was written for, but is
   wrong here: there is no dialog, no pending grant, and the Calendars
   permission the operator already granted is entirely irrelevant to this
   failure.

Answering the operator's three framings directly:
- **The tool itself**: yes — `pim-tools.ts` has exactly one bucket for "helper
  didn't exit in time" and labels it a permission problem unconditionally.
- **The permissions system**: no — EventKit/TCC is not implicated. The
  request that would exercise it (`requestFullAccessToEvents`) never runs,
  because the running binary doesn't contain `Calendar.swift` at all.
- **A missing/undisplayed prompt**: no prompt is missing — none was ever
  attempted, since the code path in the installed binary that would trigger
  one doesn't exist.

## Approaches considered

**A. Only fix packaging (wire the Swift rebuild into `scripts/build-app.sh`).**
Prevents *this* staleness from recurring, but a caller-side misdiagnosis of
"any timeout = permission prompt pending" stays latent for the next feature
added to the helper under the same manual-build gap, or any other reason the
child process fails to exit in 15s (e.g. a genuine deadlock). Cheapest, but
leaves the confusing user-facing message class unfixed.

**B. Only fix the misdiagnosis (inspect stderr on timeout).** The daemon
fallback path already prints an identifiable marker to stderr before it
blocks (`"[desktopbee-helper] listening on 127.0.0.1:"`, from
`LoopbackServer.start()`). `execFile`'s callback receives whatever
stdout/stderr was buffered before the kill, even on a timeout — so
`runDesktopBeeHelper`/`executeCalendarToday` can check for that marker and,
if present, return a distinct, accurate message ("the calendar helper needs
to be reinstalled") instead of a permission remediation. This directly kills
the confusing symptom regardless of *why* the helper is stale or hung, and is
unit-testable with the existing `CalendarHelperIO` injection seam. Doesn't
touch the packaging gap, so the underlying staleness could still recur (just
with an honest error message instead of a misleading one).

**C. Both A and B.** A closes the actual hole (stale helper can't ship
silently again). B is cheap, targeted defense-in-depth for the caller side —
same convention already used for `isPermissionError`/`permissionNeeded`, no
new concept, ~10 lines — and remains correct even for a *different* future
cause of "helper didn't exit in 15s" (e.g. it hangs for an unrelated reason:
better to say "something's wrong with the calendar helper" than "check your
Calendar permission" when the transcript shows no EventKit call ever ran).

## Decision

**C.** Both fixes are small, don't add a new concept (B extends the existing
`PERMISSION_NEEDED`-adjacent convention in `pim-preconditions.ts`; A is a
one-line addition to an existing script), and address the two distinct
failures in the chain: the packaging gap (root cause) and the misleading
diagnosis (why it was so hard for the operator to self-serve a fix).

Out of scope (per task instructions): rebuilding/re-signing/reinstalling the
already-running `/Applications/HiveMatrix.app`, or running any release/publish
step. That rebuild is the operator's to run (`bash desktopbee-helper/build-app.sh`
locally unblocks their current machine immediately; the packaging fix ensures
the next real release doesn't regress).
