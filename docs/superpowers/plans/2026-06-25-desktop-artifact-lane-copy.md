# Desktop Artifact Lane Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Task 1: Lock Desktop Artifact Copy

- [x] Update `src/lib/desktopbee/vision.test.ts` to assert the stored trace artifact title uses `Desktop Lane`.
- [x] Add `scripts/desktop-artifact-lane-copy.test.mjs`.
- [x] Assert active helper guidance files use `Desktop Lane` wording.
- [x] Assert compatibility names such as `DesktopBeeHelper` and `desktopbee-trace` remain.
- [x] Run `npm test -- src/lib/desktopbee/vision.test.ts scripts/desktop-artifact-lane-copy.test.mjs` and confirm it fails before production changes.

## Task 2: Update Desktop Artifact Copy

- [x] Update `src/lib/desktopbee/trace.ts`.
- [x] Update `desktopbee-helper/launchd/com.hivematrix.desktopbee.helper.plist.template`.
- [x] Update `desktopbee-helper/Sources/DesktopBeeHelper/main.swift`.
- [x] Update `desktopbee-helper/Sources/DesktopBeeHelper/Permissions.swift`.
- [x] Preserve artifact filenames/stems, executable names, env vars, and type names.
- [x] Run `npm test -- src/lib/desktopbee/vision.test.ts scripts/desktop-artifact-lane-copy.test.mjs` and confirm it passes.

## Task 3: Verify And Ship

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Commit and push to `main`.
