# calendar_today Stale-Helper Misdiagnosis Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-07-12-calendar-permission-misdiagnosis-design.md`

Scope: two independent, small fixes. No release/build/deploy/publish step —
that is explicitly out of scope for this task.

## Task 1 — Detect the stale/wrong-mode helper on timeout instead of assuming a pending TCC prompt

Files: `src/lib/orchestrator/pim-tools.ts`, `src/lib/orchestrator/pim-tools.test.ts`

- [x] Write a failing test in `pim-tools.test.ts`: call `executeCalendarToday`
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
- [x] Also add/keep a test for the genuine case: timeout with **empty**
  stderr still returns the existing `CalendarsPromptPending` permission
  message (regression guard — don't break the real pending-consent path).
- [x] Implement: in `pim-tools.ts`, add a small exported const, e.g.
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
- [x] Run `npm test -- --test-name-pattern pim-tools` (or the project's
  equivalent narrow-run invocation) and confirm both new tests pass and no
  existing `pim-tools.test.ts` test regresses.
- [x] Post-implementation two-stage review (spec compliance, then code
  quality — both via independent subagents) found the spec fully satisfied,
  plus four code-quality follow-ups, all applied: extracted the duplicated
  `code === HELPER_TIMEOUT_CODE` ternary at both call sites into one shared
  `classifyHelperTimeout(stderr)`; un-exported `HELPER_DAEMON_MARKER` (no
  external consumer, unlike the still-exported-and-now-directly-tested
  `looksLikeStaleHelper`); added a dedicated `looksLikeStaleHelper` true/false
  test block mirroring the existing `isPermissionError` one for parity.

## Task 2 — Rebuild the Swift helper from source before packaging, so a stale binary can never ship silently

Files: `scripts/build-app.sh`, `scripts/build-app-helper-rebuild.test.mjs` (new)

- [x] Write a failing test (new file `scripts/build-app-helper-rebuild.test.mjs`,
  following the exact convention already used in
  `scripts/service-build-lane-copy.test.mjs` — `readFileSync` the script
  source, assert with regex): assert `scripts/build-app.sh` contains a call
  into `desktopbee-helper/build-app.sh` (e.g. matches
  `/bash\s+desktopbee-helper\/build-app\.sh/`), and that this call appears
  **before** the existing `sign-bundled-machos.sh` line (compare
  `.indexOf(...)` offsets) — the helper must be freshly built before anything
  signs it. Confirm this fails against the current script (no such call
  exists today).
  (Filename changed from the plan's `build-app-daemon-rebuild.test.mjs` to
  `build-app-helper-rebuild.test.mjs` during code-quality review: "daemon" is
  already the established name for the unrelated Node.js daemon bundle
  elsewhere in `scripts/` — e.g. `build-daemon.mjs`,
  `build-daemon-python-symlinks.test.mjs` — and reusing it for the Swift
  helper rebuild risked exactly the kind of grep-confusion this whole bug was
  born from.)
- [x] Implement: in `scripts/build-app.sh`, immediately before the "Pre-signing
  source resources" step (before the existing `sign-bundled-machos.sh`
  line), add:
  ```bash
  echo "==> Rebuilding Desktop Lane helper (DesktopBeeHelper.app) from source…"
  bash desktopbee-helper/build-app.sh
  ```
  This makes `desktopbee-helper/DesktopBeeHelper.app` always reflect current
  source before `sign-bundled-machos.sh` re-signs it and Tauri bundles it —
  removing the manual step a human could forget.
- [x] Update `docs/RELEASE.md`'s description of this step (the paragraph
  around the existing "Desktop Lane helper compatibility bundle,
  `DesktopBeeHelper.app`" line) to say it is rebuilt from source at this
  point, not merely re-signed — so the doc matches the script and doesn't
  reintroduce tribal knowledge.
- [x] Run the new test and confirm it passes.

## Finishing

- [x] `npm run typecheck` — zero errors (whole project).
- [x] `npm test` — 2713/2716 pass (1 intentionally env-gated skip). The 2
  failures are pre-existing in `src/daemon/server.test.ts`
  (a port-default mismatch, 3747 vs 3799) inside unrelated in-flight work
  already sitting in this working tree before this task started — untouched
  by, and unrelated in subject matter to, both tasks here. All Task 1 + Task
  2 tests (39 in `pim-tools.test.ts` + 1 in
  `build-app-helper-rebuild.test.mjs`) pass.
- [x] `node scripts/scope-wall.mjs` — 0 violations, 0 warnings (no new
  concept was added: Task 1 extends the existing permission-message
  convention in-place; Task 2 is a script + doc edit).
- [x] Did **not** run `scripts/build-app.sh`, any release/publish script, or
  touch the installed `/Applications/HiveMatrix.app` — out of scope, operator
  releases.
- [x] Summarize: root cause, the two fixes, and verification results. (See
  commit message and the operator-facing summary from this run.)
