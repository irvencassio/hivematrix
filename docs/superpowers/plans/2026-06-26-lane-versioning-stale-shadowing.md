# Lane Versioning + Stale /Applications Shadowing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-26-lane-versioning-stale-shadowing-design.md`

## Task 1 — RED: version + plist + parser tests

- [ ] `src/lib/lane-apps/plist.test.ts` (new or extend): `parseInfoPlist` reads `HMBuildId`.
- [ ] `scripts/lane-app-versioning.test.mjs` (new): terminal `Resources/Info.plist`
  is `0.1.2`/`3` + has `HMBuildId`; browser plist has `HMBuildId`; both packagers
  inject `HMBuildId`; `expectedVersionFor(terminal)` newer than `0.1.1 (2)`;
  Profiles screen has `deleteProfile`/`editProfile` (build marker). Run → fail.

## Task 2 — GREEN: version bump + build identity

- [ ] Bump `terminal-lane-app/Resources/Info.plist` → `0.1.2`/`3`; add `HMBuildId`
  (`dev`) to both lane plists.
- [ ] `parseInfoPlist` + `ParsedInfoPlist` read `HMBuildId`.
- [ ] `PINNED_EXPECTED["terminal-lane"]` → `{short:"0.1.2",build:"3"}`.
- [ ] Both packagers: after copying Info.plist, replace the `HMBuildId` string with
  `git rev-parse --short HEAD`.

## Task 3 — RED→GREEN: status model (stale_copy + build id)

- [ ] Extend `src/lib/lane-apps/status.test.ts`: same version + different build id →
  `stale_copy`; same version + same id → `installed`; older version → `update_available`.
- [ ] `contracts.ts`: add `"stale_copy"` to `LANE_APP_STATUSES`.
- [ ] `status.ts`: `ResolveStatusInput` gains `installedBuildId?`/`expectedBuildId?`;
  add the stale_copy rule.

## Task 4 — RED→GREEN: per-copy + shadow detection in getLaneAppState

- [ ] Extend `src/lib/lane-apps/index.test.ts`: `/Applications` wins active; stale
  `/Applications` + current user copy → `shadowed` + `stale_copy`; `installedCopies`
  shape; keep existing cases green (readInstalled-only path still works).
- [ ] `index.ts`: add `expectedBuildId?`, `readBuildId?`, `readVersionAt?` deps;
  build `installedCopies`; compute `shadowed`/`activeIsStale`; fold build id +
  shadow into status; add fields to `LaneAppState`; wire real deps in
  `getAllLaneAppStates`/`verifyLaneAppById`/`installLaneAppById` (read each copy's
  Info.plist version + HMBuildId; `expectedBuildId` from the artifact).

## Task 5 — RED→GREEN: lane-setup stale state + install messaging + repair

- [ ] Extend `src/lib/lane-setup/index.test.ts`: `stale_copy → installState "stale"`
  (never "current"); shadowed → nextAction "Update /Applications copy"; entry carries
  `installedCopies`/`shadowed`.
- [ ] `lane-setup`: `LaneInstallState += "stale"`, `LaneActionId += "repair"`;
  `installStateFor`; `pickNextAction`; entry fields.
- [ ] `index.ts` (lane-apps): `installLaneAppById` returns `{...,activePath,shadowed,warning?}`.
- [ ] `repairApplicationsCopy(id)` (writable → replace; else instructions) + a unit test.
- [ ] `server.ts`: `POST /lane-apps/:id/repair-applications` (id-constrained) + the
  install handler returns the active path/warning. Endpoint test in
  `scripts/lane-apps-endpoints.test.mjs`.

## Task 6 — GREEN: console

- [ ] `renderLaneSetup`: list `installedCopies` (mark active/stale), show the shadow
  warning, render the "Update /Applications copy" repair button + `laneRepairApplications`.
  Console source test in `scripts/lane-apps-console.test.mjs`.

## Task 7 — Rebuild + gates

- [ ] `node scripts/package-terminal-lane-app.mjs`, `node scripts/package-browser-lane-app.mjs`.
- [ ] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`, `node --import tsx/esm scripts/release-smoke.mjs`.
- [ ] Install Terminal Lane locally; confirm `0.1.2 (3)` + Profiles edit/delete.

## Task 8 — Commit & push to main

- [ ] Commit; push; report hash + rebuild/install status.
