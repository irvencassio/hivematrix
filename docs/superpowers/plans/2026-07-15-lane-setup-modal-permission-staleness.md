# Lane Setup Modal Permission Staleness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-07-15-lane-setup-modal-permission-staleness-design.md`

Both tasks touch `src/daemon/console.ts` in different, non-overlapping
functions — execute sequentially (not in parallel subagents) to avoid two
agents editing the same file concurrently.

## Task 1 — Bug A: Mail Lane automation mark ignores skip vs. denied

File: `src/daemon/console.ts`, function `renderMailBeeState` (currently
~line 5481-5509).

- [ ] **Red:** In `src/daemon/console.test.ts`, add a test that extracts
  `renderMailBeeState` via the file's established `new Function("document",
  ...)` DOM-stub pattern (see `"translucency row syncs to wallpaper/theme
  state..."` test, ~line 2126-2168, for the exact idiom: stub
  `document.getElementById` returning lazily-created `{style, value,
  textContent, className}` objects). Call the extracted function twice:
  1. `renderMailBeeState({ mailControllable: true, enabled: false, ... })` —
     assert `ml_auto_mark.className` contains `ok`.
  2. `renderMailBeeState({ mailControllable: false, mailProbeSkipped: true,
     mailProbeReason: 'channel_disabled', enabled: false, ... })` — assert
     `ml_auto_mark.className` **still** contains `ok` (must not have been
     downgraded by the skip).
  Also assert a passive skip still updates `ml_chan_mark`/identities
  normally (pass a differing `enabled`/`identities` value on the second call
  and confirm those DID update) — the fix must not freeze the whole
  function, only the automation-permission fields.
  Run `npm test -- --test-name-pattern <name>` (or the project's equivalent
  filtered run) and confirm it fails against current code.
- [ ] **Green:** In `renderMailBeeState`, wrap the `mark('ml_auto_mark',
  controllable)` call and the `detailEl` block in `if (!(data &&
  data.mailProbeSkipped)) { ... }`. Leave `mark('ml_chan_mark', enabled)`
  and the `data.identities` block outside the guard, unchanged. Add a short
  comment above the guard (mirror the existing `fdaSkipped` comment in
  `renderMessageBeeState`, ~line 5334-5336) explaining a skip carries no
  information and must not overwrite a real result.
- [ ] Re-run the new test — confirm it passes. Run the full
  `console.test.ts` suite to confirm no other test regressed (several
  existing tests already assert on `renderMailBeeState`'s source shape via
  string matching — check none of them assert the mark-setting lines are
  unconditional).

## Task 2 — Bug B: "Restart daemon" doesn't re-check the open Message Lane modal

File: `src/daemon/console.ts`, function `restartMessageBeeDaemon` (currently
~line 5198-5211).

- [ ] **Red:** Add a test asserting `restartMessageBeeDaemon`'s body, after
  the successful-restart branch, calls `api('/messagebee/probe', { method:
  'POST' })` and passes the result to `renderMessageBeeState` — not just
  `setTimeout(refresh, 3000)` alone. Follow this file's existing convention
  for testing an async function's body via `fnBody`/`extractBetween` +
  regex assertions on the call sequence (see the `_obPollPerms`/`mlFireProbeOnce`-style
  tests already in the file for the pattern) rather than the heavier DOM-stub
  approach from Task 1 — this one is about *which calls happen*, not
  DOM output shape. Confirm it fails against current code (current code only
  calls `setTimeout(refresh, 3000)`).
- [ ] **Green:** Change the success branch of `restartMessageBeeDaemon()` so
  that, after setting the "Daemon restarting — re-checking access…" status
  text, it re-probes and re-renders the modal directly — reuse the same
  `api('/messagebee/probe', {method:'POST'})` → `renderMessageBeeState(r)`
  pair `openMessageBeeSetup()` already uses (~line 5124-5125), on the same
  `setTimeout(..., 3000)` delay (gives `launchctl kickstart -k` time to bring
  the daemon back up) — plus still calling `refresh()` for the rest of the
  UI (board/onboarding/etc.), so nothing already working regresses.
- [ ] Re-run the new test — confirm it passes. Run the full
  `console.test.ts` suite.

## Verification gate (per AGENTS.md)

```
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

`qwen-readiness.mts` not required — neither task touches local-model paths.

## Out of scope / explicitly not touched

- Message Lane's already-correct probe/remediation logic (Issue 1,
  `docs/superpowers/specs/2026-07-15-message-lane-fixes-design.md`) — not
  re-litigated, confirmed still working via live testing in the design doc.
- Issues 2/3/4 from that same doc (config-loss guard, home banner, Browser
  Lane build-ID) — unrelated to this report, already separately
  planned/shipped.
- No release/build/publish step. Operator releases.
