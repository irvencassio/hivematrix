# Top-Level Lane Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Task 1: Lock Top-Level Copy

- [x] Add `scripts/top-level-lane-copy.test.mjs`.
- [x] Assert README and ONBOARDING use Desktop Lane wording.
- [x] Assert app permission plists use Voice Lane and Desktop Lane wording.
- [x] Assert voice sidecar and video package copy use Voice Lane wording.
- [x] Preserve compatibility names such as `DesktopBeeHelper.app`.
- [x] Run `npm test -- scripts/top-level-lane-copy.test.mjs` and confirm it fails before production changes.

## Task 2: Update Top-Level Copy

- [x] Update `README.md`.
- [x] Update `ONBOARDING.md`.
- [x] Update `src-tauri/Info.plist`.
- [x] Update `desktopbee-helper/Resources/Info.plist`.
- [x] Update voice sidecar docs/CLI strings and video package description.
- [x] Run `npm test -- scripts/top-level-lane-copy.test.mjs` and confirm it passes.

## Task 3: Verify And Ship

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Commit and push to `main`.
