# Landed Flight Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-28-landed-flight-delete-design.md`

- [x] RED: Add a daemon store test in `src/lib/work-packages/store.test.ts`: create a Flight, link a child task, leave child state stale active, mark the package `done`, and assert `deleteWorkPackage()` returns `{ deleted: true }`.

- [x] RED: Add a daemon HTTP test in `src/daemon/server.test.ts`: create a Flight with stale active linked child state, mark the package `done_with_skips`, call `DELETE /work-packages/:id`, and assert 200/deleted.

- [x] GREEN: Update `deleteWorkPackage()` in `src/lib/work-packages/store.ts` so terminal package status bypasses stale child running/active guards while non-terminal packages keep those guards.

- [x] RED: Add iOS tests in `/Users/irvencassio/hivematrix-ios/HiveMatrixTests/SmokeTests.swift` for `Flight.isLanded`, and source checks proving `BoardView` and `FlightsView` attach `.swipeActions` gated by `flight.isLanded`.

- [x] GREEN: Update `/Users/irvencassio/hivematrix-ios/HiveMatrix/Models/Models.swift`, `Services/AppStore.swift`, `Views/BoardView.swift`, and `Views/FlightsView.swift` to support landed-only swipe delete with a shared delete helper.

- [x] VERIFY: Run focused daemon/iOS tests, then `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`, and the iOS build/test command for the touched Swift code.
