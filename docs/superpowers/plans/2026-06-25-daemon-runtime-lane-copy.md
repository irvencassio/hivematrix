# Daemon Runtime Lane Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Task 1: Lock Health Detail Copy

- [x] Update `src/daemon/console.test.ts`.
- [x] Add a test that reads `server.ts` and asserts `Desktop Lane helper unreachable on :3748`.
- [x] Assert `DesktopBee helper unreachable` is absent.
- [x] Run `npm test -- src/daemon/console.test.ts` and confirm it fails before production changes.

## Task 2: Update Runtime Copy

- [x] Update `src/daemon/server.ts`.
- [x] Change the `/desktopbee/health` fallback detail to `Desktop Lane helper unreachable on :3748`.
- [x] Change nearby comments to lane language while keeping route paths and import/function names stable.
- [x] Update `src/daemon/index.ts` startup comments to `Message Lane`, `Mail Lane`, `Review Lane`, and `Memory Lane`.
- [x] Run `npm test -- src/daemon/console.test.ts` and confirm it passes.

## Task 3: Verify And Ship

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Commit and push to `main`.
