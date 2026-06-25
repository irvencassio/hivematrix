# Browser Lane Code Prose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Task 1: Lock Browser Lane Code Prose

- [x] Add `scripts/browser-lane-code-prose.test.mjs`.
- [x] Assert selected source comments/test labels use Browser Lane wording.
- [x] Assert selected prose no longer contains old phrases such as `WebBee summarization`, `WebBee disabled in local-only`, `BrowserBee/Canopy principle`, or `collapse BrowserBee and WebBee`.
- [x] Run `npm test -- scripts/browser-lane-code-prose.test.mjs` and confirm it fails before production changes.

## Task 2: Update Browser Lane Code Prose

- [x] Update `src/lib/routing/router.ts`.
- [x] Update `src/daemon/connectivity-integration.test.ts`.
- [x] Update `src/lib/desktopbee/actions.ts`.
- [x] Update `src/lib/lanes/status.test.ts`.
- [x] Preserve compatibility ids, routes, config keys, and exported TypeScript names.
- [x] Run `npm test -- scripts/browser-lane-code-prose.test.mjs` and confirm it passes.

## Task 3: Verify And Ship

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Commit and push to `main`.
