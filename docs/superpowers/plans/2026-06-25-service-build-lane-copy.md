# Service Build Lane Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Task 1: Lock Service/Build Copy

- [x] Add `scripts/service-build-lane-copy.test.mjs`.
- [x] Assert `src/lib/bees/service-manager.ts` uses lane wording for operator-facing errors.
- [x] Assert `scripts/sign-bundled-machos.sh` says `Desktop Lane helper (DesktopBeeHelper.app)`.
- [x] Assert `docs/RELEASE.md` describes `DesktopBeeHelper.app` as the Desktop Lane helper bundle.
- [x] Run `npm test -- scripts/service-build-lane-copy.test.mjs` and confirm it fails before production changes.

## Task 2: Update Service/Build Copy

- [x] Update `src/lib/bees/service-manager.ts`.
- [x] Update `src/lib/bees/service-manager.test.ts` test names/comments only.
- [x] Update `scripts/sign-bundled-machos.sh`.
- [x] Update `docs/RELEASE.md`.
- [x] Preserve helper bundle names and internal ids.
- [x] Run `npm test -- scripts/service-build-lane-copy.test.mjs src/lib/bees/service-manager.test.ts` and confirm it passes.

## Task 3: Verify And Ship

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Commit and push to `main`.
