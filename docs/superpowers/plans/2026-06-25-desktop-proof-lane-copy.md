# Desktop Proof Lane Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Task 1: Lock Proof Output Copy

- [x] Add `scripts/desktop-lane-proof-copy.test.mjs`.
- [x] Read `scripts/desktopbee-proof.mts`.
- [x] Assert the script contains `Desktop Lane Phase 4 Proof` and `HiveMatrix Desktop Lane proof`.
- [x] Assert it does not contain `DesktopBee Phase 4 Proof`, `HiveMatrix DesktopBee proof`, or `Requires: DesktopBee helper`.
- [x] Run `npm test -- scripts/desktop-lane-proof-copy.test.mjs` and confirm it fails before production changes.

## Task 2: Update Proof Script Copy

- [x] Update `scripts/desktopbee-proof.mts`.
- [x] Change operator comments to `Desktop Lane helper`.
- [x] Change visible proof title to `Desktop Lane Phase 4 Proof`.
- [x] Change typed sample proof text to `HiveMatrix Desktop Lane proof`.
- [x] Keep DesktopBee API imports and calls unchanged.
- [x] Run `npm test -- scripts/desktop-lane-proof-copy.test.mjs` and confirm it passes.

## Task 3: Verify And Ship

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Commit and push to `main`.
