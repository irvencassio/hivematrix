# Flight Detail Observability — Design

> Operator diagnostic requirement: "tell why a Flight stopped without reading SQLite directly"

## Problem

`GET /work-packages/:id` is the primary Flight diagnostic surface but requires 2 additional API
calls (`/loop`, `/loop/passes`) to understand loop state and pass outcomes. Items carry
`createdTaskId` but not the linked task's current board status. Pass rows in the console don't
render `evidence.state`, the error message for failed passes, or timestamps for completed items.

## Changes

### 1. `WorkPackageItem` — add `taskStatus`

A LEFT JOIN to `tasks` on `createdTaskId` supplies the board task's current status. This answers
"is the linked task in_progress, failed, review, done?" without a second query.

### 2. `WorkPackageDetail` — add `failedCount`, `reviewCount`, `loop`, `recentPasses`

`failedCount` / `reviewCount` are already computable from `counts` but are surfaced as top-level
fields for API consumers. `loop` (full `FlightLoop` object) and `recentPasses` (last 5 passes as
`FlightLoopPassSummary`) are inlined so one HTTP call answers all diagnostic questions.

`FlightLoopPassSummary` is a projection: passNumber, status, startedAt, completedAt, stopReason,
summary, createdItemCount, evidenceState, error — everything needed to scan history fast without
the raw evidence blob.

### 3. Console rendering improvements

- `flightPassRowHtml`: render `evidence.state` label + `error` block for failed passes.
- Item rows: render `taskStatus` badge next to task ID.
- Flight header sub-line: render `completedAt` for terminal Flights.
- `renderFlightDetail`: drop the redundant `/loop` GET (use `p.loop` from main response).

### 4. Tests

- `store.test.ts`: taskStatus hydration, failedCount/reviewCount, loop/passes inline.
- `server.test.ts`: GET /work-packages/:id covers all new fields via HTTP.
- `console.test.ts`: regex guards on evidence state, error rendering, taskStatus, completedAt.

## Non-changes

The separate `/loop`, `/loop/passes`, `/loop/summary` endpoints are kept as-is; they serve
real-time polling and the full 50-pass history. The console still fetches `/loop/passes` for the
full list. `recentPasses` in the main response is for single-call diagnostics.
