# Lane Visible Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Task 1: Pin Lane Names At The Catalog Boundary

- [x] Add failing assertions in `src/lib/bees/catalog.test.ts`:
  - `messagebee` displays `Message Lane`.
  - `mailbee` displays `Mail Lane`.
  - `managerbee` displays `Review Lane`.
  - `brainbee` displays `Memory Lane`.
  - `termbee` displays `Terminal Lane`.
  - `desktopbee` displays `Desktop Lane`.
- [x] Update `src/lib/bees/catalog.ts` `name` fields and nearby comments/summaries to lane language.
- [x] Run `npm test -- src/lib/bees/catalog.test.ts`.

## Task 2: Make Compatibility Status Lane-Shaped

- [x] Add a failing assertion in `src/daemon/console.test.ts` or server source test coverage proving `/bees` imports `listLaneServiceStatuses`, not `listBeeServiceStatuses`.
- [x] Update `src/daemon/server.ts` so `GET /bees` returns `{ bees: await listLaneServiceStatuses() }`.
- [x] Run `npm test -- src/daemon/console.test.ts`.

## Task 3: Remove Visible Bee Names From Console Strings

- [x] Add failing assertions in `src/daemon/console.test.ts` for visible strings:
  - No `Set up MessageBee`, `Set up MailBee`, `Enable MailBee`.
  - No `MessageBee — iMessage / SMS`, `MailBee — Email`.
  - No visible provenance strings `ManagerBee / directive`, `MessageBee`, `MailBee`.
  - Positive checks for the corresponding lane names.
- [x] Update `src/daemon/console.ts` visible text.
- [x] Run `npm test -- src/daemon/console.test.ts`.

## Task 4: Verify The Full Slice

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Commit and push to `main`.
