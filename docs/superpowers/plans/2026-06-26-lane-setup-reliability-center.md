# Lane Setup & Reliability Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-26-lane-setup-reliability-center-design.md`

New file: `src/lib/lane-setup/index.ts` (+ `index.test.ts`). Edits:
`src/daemon/server.ts`, `src/daemon/console.ts`, `src/daemon/console.test.ts`,
new `scripts/lane-setup-endpoints.test.mjs`. No Swift/packaging changes.

## Task 1 — RED: lane-setup model unit tests

- [ ] Create `src/lib/lane-setup/index.test.ts`. Import `getLaneSetup` and call
  it with fully-stubbed deps. Assert per the design's case matrix:
  - installState mapping for each app status.
  - launchState: isRunning→running/not_running; verification launchOk:false→failed; pgrep-unknown→unknown.
  - signingState: verification signatureOk true/false/absent → valid/invalid/unknown.
  - daemonState: dashboard stub that throws → unavailable; else reachable.
  - nextAction priority (Install / Update / Verify / Launch / Run readiness / Open).
  - disabledReasons present (launch/verify) when not_installed.
  - browser & terminal readiness summary counts.
- [ ] Add a no-secrets test: stub dashboards carrying credentialRef/host/user/
  password; assert `JSON.stringify(getLaneSetup(...))` matches none of
  `/credentialRef|password|private_key|passphrase|providerAccount|"host"|"user"/`.
- [ ] Run `node --import tsx/esm --test src/lib/lane-setup/index.test.ts` → fail
  (module missing).

## Task 2 — GREEN: implement `src/lib/lane-setup/index.ts`

- [ ] Define types (`LaneSetupEntry`, summaries) per design.
- [ ] `recordLaneVerification(id, {signatureOk,launchOk})` + `getLaneVerification(id)`
  module-level Map cache.
- [ ] Default `isLaneAppRunning(executable)` via `spawnSync("pgrep", ["-f", executable])`
  (read-only; fixed name); returns boolean | null (null on spawn error).
- [ ] `getLaneSetup(deps?)`: compose `getAllLaneAppStates()` (no verify) +
  per-lane dashboard (try/catch → daemonState) + isRunning + verification cache;
  derive every field; build nextAction + disabledReasons.
- [ ] Re-run unit tests → green.

## Task 3 — RED→GREEN: endpoint

- [ ] Create `scripts/lane-setup-endpoints.test.mjs` asserting: server.ts has a
  `GET /lane-setup` handler calling `getLaneSetup`; `/verify` handler calls
  `recordLaneVerification`; no shell/`exec` route; existing routes still
  id-constrained. Run → fail.
- [ ] In `src/daemon/server.ts`: add `GET /lane-setup` →
  `json(res,200,{ok:true,...await getLaneSetup()})`; in the existing
  `/lane-apps/:id/verify` handler, after `verifyLaneAppById`, call
  `recordLaneVerification(id, result.verification)` when present.
- [ ] Run → green.

## Task 4 — RED: console layout + button-consistency tests

- [ ] In `src/daemon/console.test.ts` add tests:
  - `renderLaneSetup` defined, fetches `/lane-setup`, wired into the Lanes tab
    switch and fills `#lane_apps`.
  - cards show install-state, a `Signing`/`Launch`/`Daemon` line, a readiness
    summary, a primary action button, and disabled buttons that include reason text.
  - Browser dashboard surfaces auth strategy + the no-bypass hint copy.
  - Terminal copy explains local-vs-SSH (no key needed for local).
  - subordinate sections ("Browser Lane Sites & Auth", "Terminal Lane Profiles &
    Readiness") still present.
- [ ] Run → fail.

## Task 5 — GREEN: console implementation

- [ ] Replace `renderLaneApps()` with `renderLaneSetup()` (same `#lane_apps`
  mount) consuming `/lane-setup`; render the polished cards + disabled-with-reason
  buttons; reuse `laneAppAction` for install/verify/launch/reveal and add
  `laneRunReadiness(id)` posting to the correct readiness endpoint.
- [ ] Update the Lanes tab switch + the section refresh button to call
  `renderLaneSetup()`.
- [ ] Add auth-strategy + honest-state + no-bypass hint to `renderBrowserReadiness`.
- [ ] Add local-vs-SSH explainer + actionable status text to the Terminal section/
  `renderTerminalReadiness`.
- [ ] Re-frame the two readiness sections as subordinate (copy/markers).
- [ ] Run console tests → green.

## Task 6 — Gates

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `node scripts/scope-wall.mjs`
- [ ] Confirm no Swift/packaging change → no Lane rebuild, no `release:verify`.

## Task 7 — Commit & push to main

- [ ] Stage all; commit; push; report commit hash + rebuild status.
