# Post-update Lane App Updates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-26-post-update-lane-app-updates-design.md`

## Task 1 — RED: lane-setup aggregate tests

- [ ] Extend `src/lib/lane-setup/index.test.ts`: `needsUpdate` per entry
  (current→false, outdated/stale/shadowed→true); top-level `updateSummary`
  (displayNames + count + anyShadowed); entries carry `installedBuildId` /
  `bundledBuildId`; serialized model has no secrets. Run → fail.

## Task 2 — GREEN: lane-setup model

- [ ] `LaneSetupEntry`: add `installedBuildId`, `bundledBuildId`, `needsUpdate`.
- [ ] `LaneSetup`: add `updateSummary`. Compute in `getLaneSetup` from
  `state.installedBuildId/expectedBuildId` + installState/shadowed.
- [ ] Run → green.

## Task 3 — RED→GREEN: updateAllStaleLaneApps + endpoint

- [ ] New `src/lib/lane-apps/update-all.test.ts` (or extend index.test.ts):
  `updateAllStaleLaneApps({getStates, install, repair})` — stale shadowing lane →
  install + repair writable /Applications → `replacedApplications`; current lane
  skipped; non-writable → `warning` + `shadowed:true`. Run → fail.
- [ ] Implement `updateAllStaleLaneApps(deps?)` in `src/lib/lane-apps/index.ts`
  (default deps wire `getAllLaneAppStates`/`installLaneAppById`/`repairApplicationsCopy`).
- [ ] `scripts/lane-apps-endpoints.test.mjs`: assert `POST /lane-apps/update-all`
  declared + `updateAllStaleLaneApps`.
- [ ] `server.ts`: add the route. Run → green.

## Task 4 — RED→GREEN: console

- [ ] `scripts/lane-apps-console.test.mjs`: post-update banner copy ("Lane apps
  need update"), `Update Lane Apps` button, `laneUpdateAll`, `updateSummary`,
  `bundledBuildId`/`installedBuildId` (build identity shown). Run → fail.
- [ ] `console.ts` `renderLaneSetup`: render the banner from `updateSummary`, the
  Update-all button + `laneUpdateAll()`, and the `build <id>` line on cards.
  Run → green.

## Task 5 — Gates + rebuild + manual verify + push

- [ ] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`,
  `node --import tsx/esm scripts/release-smoke.mjs`.
- [ ] `node scripts/package-{terminal,browser}-lane-app.mjs`.
- [ ] Manual: write a stale HMBuildId into the installed Info.plist; confirm
  getLaneSetup reports `needsUpdate`/banner; run update-all; confirm fixed.
- [ ] Commit; push; report hash.
