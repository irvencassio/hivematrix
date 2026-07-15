# Message Lane Reliability + Browser Lane Verify Caching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

Design: `docs/superpowers/specs/2026-07-15-message-lane-fixes-design.md` (Issues 1, 2, 4)
and `docs/superpowers/specs/2026-07-15-message-lane-fallback-alert-design.md` (Issue 3).
Operator answered the fallback-alert doc's open questions with "Just proceed" —
adopting Recommendation B and all 4 defaults there.

**Budget note:** this session has a hard $10 cap; ~$6.9 was spent re-investigating
before finding these already-written design docs (both docs were sitting uncommitted
in `docs/superpowers/` — lesson for next time: check `git status` / existing
`docs/superpowers/` artifacts before spawning research agents). Remaining budget
(~$3) requires scoping Issues 2 and 4 down from their full recommendations. Deferrals
are called out explicitly per "no silent caps" — not silently dropped.

Do NOT touch the other in-flight, unrelated uncommitted changes in this working tree
(`src/daemon/index.ts`, `src/daemon/server.ts`, `src/lib/feedback/self-improvement.ts`,
`src/lib/voice/command-context.ts`, `src/lib/voice/command-turn.ts`, and their tests) —
these belong to a separate overnight punch list (`docs/superpowers/plans/2026-07-15-overnight-punchlist.md`),
a different task. Commit only the files this plan touches.

## Task 1 — Issue 1: FDA false-negative messaging + real remediation

Root cause (confirmed, design doc): the daemon that reads `chat.db` is a distinct,
separately-signed process (`Contents/Resources/daemon/bin/node`, run as its own
launchd agent), not the app bundle the user grants FDA to in System Settings. The
probe is honest; the message is wrong and there's no real fix action.

- `src/lib/messagebee/imessage.ts` (~line 100-127, `open_failed` remediation text
  ~line 108-112): stop saying "restart HiveMatrix" (does nothing — relaunching the
  GUI app doesn't touch the already-running launchd daemon, confirmed via
  `lib.rs:498-503`). State the real cause and point at the daemon binary specifically.
- `src/daemon/console.ts` (`renderMessageBeeState`, ~5277-5300): fix the
  skipped-vs-denied conflation — a probe result of `chatDbProbeSkipped` (channel not
  yet enabled) must not render identically to a genuine `open_failed` denial.
- Add one real remediation action: reveal the daemon binary in Finder
  (`open -R <path>`, using the already-resolved path from
  `getBundledDaemonPaths()`/`app-bundle.ts`) so the user can drag the correct binary
  into the FDA list's `+` picker. Shell out the same way `verify.ts`/`actions.ts`
  already do (codesign/spctl/osascript/launchctl precedent) — no new Tauri
  capability needed, this is backend-only.
- Add a "restart daemon" action reusing the existing `launchctl kickstart -k`
  pattern from `src/lib/updater/daemon-update.ts` (~73-78), for the case where FDA
  was already granted and the process just needs to pick it up.
- New small endpoint(s) in `src/daemon/server.ts` near the existing
  `/messagebee/*` and `/onboarding/setup/full-disk-access/*` routes.
- Tests first: probe-detail text assertion, skipped-vs-denied render assertion,
  reveal/restart action unit tests (mock `execFile`).

## Task 2 — Issue 3: Home screen warning banner

Approach B (fold into `system-readiness` as a 7th check) + all 4 defaults from the
fallback-alert design doc:
1. Placement: inside `renderOverview()`'s own template (home-page-only).
2. Classification: `open_failed`/`missing` → configuration; `schema_failed` →
   system; `chatDbReadable===true` but recent `lastError` → system (show the stored
   error verbatim); `!enabled` → no banner (intentional off-state).
3. Actions: text-only steps + the one real button, `openFullDiskAccess()`.
4. Gate: only when `notify.channels.includes("imessage") && isChannelEnabled()`.

- `src/lib/messagebee/status.ts`: stop dropping `chatDbProbeReason` (currently kept
  only as `detail` text, ~line 40-41) — return the structured reason too.
- Add a new getter for the currently write-only `message_channels.lastError` /
  `lastInboundAt` / `lastOutboundAt` columns (written by
  `src/lib/messagebee/store.ts` `recordError()` ~117-120; nothing reads them back
  today — confirm via grep before adding, per design doc).
- `src/lib/system-readiness/index.ts` (~12-20 shape, ~269-285 assembly): add a
  `message-lane` check using the classification above, `severity: warn|critical`,
  `summary`, `nextAction`, `repairActions` including the FDA pane action.
- `src/daemon/console.ts`: `refresh()` (~5518-5547) already calls `/system/readiness`
  for the Settings tab — reuse that same fetch in the `Promise.all`, don't add a new
  endpoint. Add `renderMessageLaneBanner()` filtering the readiness report to
  `id === "message-lane"`, rendering only on `warn`/`critical`, with a mention of
  the access ledger (`~/_GD/brain/hive/playbooks/projects/solo-founder-os-access.md`)
  as an operational-history pointer (not a live data source — it can be stale, per
  the fallback-alert doc's own finding). Dismiss via one new localStorage key,
  auto-cleared the instant severity returns to `ok`. Style: reuse the lane-apps
  "needs update" banner idiom (`.card{border:1px solid var(--warn)}`, `⚠`) already
  in console.ts (~8440-8450) — no new CSS primitive.
- Tests first: classification function (all 4 branches), readiness report includes
  the new check id, banner render gated correctly by the notify/enabled condition.

## Task 3 — Issue 2 (scoped) + Issue 4 (scoped)

**Issue 2, scoped down from the design doc's full recommendation.** The full fix
(wire the tested `applyUpdate()` backup/rollback pipeline into the real Tauri
`check_for_update` path, `src-tauri/src/lib.rs`) is cross-language (Rust+Node),
requires exercising a real app auto-update cycle to verify, and is explicitly
deferred below — not attempted this pass. Instead, ship the two safe, testable,
TypeScript-only pieces that reduce the reported symptom regardless of which
candidate root cause is real:
- `src/lib/messagebee/store.ts` `setSelfHandles()` (~187-193): guard against a
  wholesale wipe — an empty-array call must not silently discard existing
  self-handles unless an explicit `{force: true}`/clear intent is passed. Write the
  failing test first (existing handles + blank resubmit → handles preserved unless
  forced).
- Verify (and fix if not already true) that the Message Lane setup dialog
  pre-populates from existing DB rows (`listIdentities()`/`getSelfHandles()` in
  `src/lib/onboarding/setup-status.ts` ~272-297 already reads live DB state per
  investigation) rather than presenting a blank form when identities/allowlist
  already exist — this is the direct fix for "users must reconfigure after every
  update" in the common case where data survives but the UI doesn't show it.

**Issue 4 (secondary), approach A only** (build-ID scoping — cheap, high
confidence; approach B, persisting the verify cache in DB, is deferred below):
- `scripts/package-browser-lane-app.mjs` `stampBuildId()` (~10-21): scope the hash
  to `browser-lane-app/` contents only instead of `git rev-parse --short HEAD` for
  the whole repo, so unrelated commits elsewhere stop invalidating Browser Lane's
  install/signing state. Check `isCurrent()` in `src/lib/lane-apps/index.ts`
  (~84-89) for the comparison format to stay compatible.
- Tests first: build-id stable across an unrelated-path commit, changes when a
  `browser-lane-app/` file changes.

## Deferred (explicitly, due to budget — not silently dropped)

- Issue 2 full fix: wiring the tested `applyUpdate()` backup/rollback pipeline
  (`src/lib/updater/updater.ts:178-218`) into the real production update path
  (`src-tauri/src/lib.rs` `check_for_update`, `src/lib/updater/feed-check.ts`
  `applyUpdateViaRelaunch`). Needs its own session/budget and a way to exercise a
  real update cycle.
- Issue 4 approach B: persisting the Browser Lane verification cache in a DB row
  keyed by installed-bundle CDHash, so a daemon restart alone no longer forces
  `signingState` back to `"unknown"`.
- Issue 1's Approach C (unify daemon + app under one FDA identity) — explicitly out
  of scope per the design doc's own Non-Goals.

## Verification gate (per AGENTS.md)

```
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

No release/build/publish step. Operator releases.
