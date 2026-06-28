# Flight Detail Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Tasks

- [ ] **Task 1** `src/lib/work-packages/store.ts`
  - Import `FlightLoop`, `PassStatus`, `getLoopPasses` from `./flight-loop-store`
  - Add `taskStatus: string | null` to `WorkPackageItem`
  - Add `FlightLoopPassSummary` interface
  - Add `failedCount`, `reviewCount`, `loop`, `recentPasses` to `WorkPackageDetail`
  - Update `rowToItem` to set `taskStatus: null`
  - Update `getWorkPackage` to LEFT JOIN tasks + fetch loop + fetch recentPasses

- [ ] **Task 2** `src/lib/work-packages/store.test.ts` — failing tests first
  - `getWorkPackage items have taskStatus null when no linked task`
  - `getWorkPackage items have taskStatus from linked task after createTaskFromItem`
  - `getWorkPackage failedCount and reviewCount match item statuses`
  - `getWorkPackage loop is null when no loop configured`
  - `getWorkPackage loop is inlined when loop exists`
  - `getWorkPackage recentPasses is empty when no passes`
  - `getWorkPackage recentPasses summarises completed passes`

- [ ] **Task 3** `src/daemon/server.test.ts` — HTTP-level tests
  - `GET /work-packages/:id includes items array with taskStatus field`
  - `GET /work-packages/:id includes counts skippedCount failedCount reviewCount timestamps`
  - `GET /work-packages/:id includes loop=null and recentPasses=[] when no loop`
  - `GET /work-packages/:id includes inline loop and recentPasses after loop+pass creation`

- [ ] **Task 4** `src/daemon/console.ts`
  - `renderFlightDetail`: use `p.loop` from response; skip redundant `/loop` GET
  - `renderFlightDetail`: add `completedAt` to Flight sub-line for terminal Flights
  - Item rendering: add `taskStatus` badge after task ID
  - `flightPassRowHtml`: add `evidenceState` to meta line (from `pass.evidence.state`)
  - `flightPassRowHtml`: add `error` block for failed passes

- [ ] **Task 5** `src/daemon/console.test.ts`
  - `flightPassRowHtml renders evidence state label`
  - `flightPassRowHtml renders error block for failed passes`
  - `renderFlightDetail item rows reference taskStatus`
  - `renderFlightDetail shows completedAt for terminal flights`
  - `GET /work-packages/:id response shape inlines loop and recentPasses`

## Verification

```
npm run typecheck   # zero errors
npm test            # all tests pass
```
