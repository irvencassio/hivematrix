# calendar_today Stale-Helper Misdiagnosis Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-07-12-calendar-permission-misdiagnosis-design.md`

Scope: two independent, small fixes. No release/build/deploy/publish step —
that is explicitly out of scope for this task.

## Task 1 — Detect the stale/wrong-mode helper on timeout instead of assuming a pending TCC prompt

Files: `src/lib/orchestrator/pim-tools.ts`, `src/lib/orchestrator/pim-tools.test.ts`

- [ ] Write a failing test in `pim-tools.test.ts`: call `executeCalendarToday`
  with a fake `CalendarHelperIO` whose `run()` resolves `{ code:
  HELPER_TIMEOUT_CODE (124), stdout: "", stderr: "[desktopbee-helper]
  listening on 127.0.0.1:3748\n" }` (i.e. the exact marker
  `main.swift`'s `LoopbackServer.start()` writes to stderr before blocking).
  Assert the returned string is **not** `permissionNeeded(...)` (i.e.
  `parsePermissionNeeded(result)` is `null`) and instead contains something
  identifying an out-of-date/misbehaving helper (e.g. matches
  `/calendar helper/i` and `/out of date|reinstall/i`). Confirm this test
  fails against current code (it currently returns
  `permissionNeeded("Calendars", REMEDIATION.CalendarsPromptPending)`).
- [ ] Also add/keep a test for the genuine case: timeout with **empty**
  stderr still returns the existing `CalendarsPromptPending` permission
  message (regression guard — don't break the real pending-consent path).
- [ ] Implement: in `pim-tools.ts`, add a small exported const, e.g.
  `HELPER_DAEMON_MARKER = "[desktopbee-helper] listening on"`, and a helper
  `looksLikeStaleHelper(stderr: string): boolean` that checks
  `stderr.includes(HELPER_DAEMON_MARKER)`. In `executeCalendarToday`, when
  `code === HELPER_TIMEOUT_CODE`, branch on `looksLikeStaleHelper(stderr)`:
  if true, return a new message (not the `PERMISSION_NEEDED` wire format —
  this is not a permission problem and must not be spoken/handled as one) such
  as `"HiveMatrix's calendar helper is out of date and can't read your
  calendar — reopen HiveMatrix or reinstall it to update it."`; else keep the
  existing `permissionNeeded("Calendars", REMEDIATION.CalendarsPromptPending)`.
  Apply the identical branch in `executeCalendarCreate` (same
  `HELPER_TIMEOUT_CODE` handling exists there — keep both call sites
  consistent, they already share the exit-code convention).
- [ ] Run `npm test -- --test-name-pattern pim-tools` (or the project's
  equivalent narrow-run invocation) and confirm both new tests pass and no
  existing `pim-tools.test.ts` test regresses.

## Task 2 — Rebuild the Swift helper from source before packaging, so a stale binary can never ship silently

Files: `scripts/build-app.sh`, `scripts/build-app-daemon-rebuild.test.mjs` (new)

- [ ] Write a failing test (new file `scripts/build-app-daemon-rebuild.test.mjs`,
  following the exact convention already used in
  `scripts/service-build-lane-copy.test.mjs` — `readFileSync` the script
  source, assert with regex): assert `scripts/build-app.sh` contains a call
  into `desktopbee-helper/build-app.sh` (e.g. matches
  `/bash\s+desktopbee-helper\/build-app\.sh/`), and that this call appears
  **before** the existing `sign-bundled-machos.sh` line (compare
  `.indexOf(...)` offsets) — the helper must be freshly built before anything
  signs it. Confirm this fails against the current script (no such call
  exists today).
- [ ] Implement: in `scripts/build-app.sh`, immediately before the "Pre-signing
  source resources" step (before the existing `sign-bundled-machos.sh`
  line), add:
  ```bash
  echo "==> Rebuilding Desktop Lane helper (DesktopBeeHelper.app) from source…"
  bash desktopbee-helper/build-app.sh
  ```
  This makes `desktopbee-helper/DesktopBeeHelper.app` always reflect current
  source before `sign-bundled-machos.sh` re-signs it and Tauri bundles it —
  removing the manual step a human could forget.
- [ ] Update `docs/RELEASE.md`'s description of this step (the paragraph
  around the existing "Desktop Lane helper compatibility bundle,
  `DesktopBeeHelper.app`" line) to say it is rebuilt from source at this
  point, not merely re-signed — so the doc matches the script and doesn't
  reintroduce tribal knowledge.
- [ ] Run the new test and confirm it passes.

## Finishing

- [ ] `npm run typecheck` — zero errors.
- [ ] `npm test` — full suite passes (confirms Task 1 + Task 2 tests integrate
  cleanly and nothing else regressed).
- [ ] `node scripts/scope-wall.mjs` — zero violations (no new concept was
  added: Task 1 extends the existing permission-message convention in-place;
  Task 2 is a script + doc edit).
- [ ] Do **not** run `scripts/build-app.sh`, any release/publish script, or
  touch the installed `/Applications/HiveMatrix.app` — out of scope, operator
  releases.
- [ ] Summarize: root cause, the two fixes, and verification results.
