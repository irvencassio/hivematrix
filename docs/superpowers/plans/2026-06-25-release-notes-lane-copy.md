# Release Notes Lane Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Task 1: Lock Release Notes Copy

- [x] Add `scripts/release-notes-lane-copy.test.mjs`.
- [x] Assert `src/lib/version/changelog.ts` uses `Voice Lane` and `Mail Lane`.
- [x] Assert `CHANGELOG.md` uses `Voice Lane` and `Mail Lane`.
- [x] Assert both files no longer contain `VoiceBee` or `MailBee`.
- [x] Run `npm test -- scripts/release-notes-lane-copy.test.mjs` and confirm it fails before production changes.

## Task 2: Update Release Notes Copy

- [x] Update `src/lib/version/changelog.ts`.
- [x] Update `CHANGELOG.md`.
- [x] Preserve version/date ordering.
- [x] Run `npm test -- scripts/release-notes-lane-copy.test.mjs` and confirm it passes.

## Task 3: Verify And Ship

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Commit and push to `main`.
