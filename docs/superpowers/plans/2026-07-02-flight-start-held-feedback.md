# Flight Start Held Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Add a failing console test in `src/daemon/console.test.ts` proving `renderBlockerBanner()` reports held blockers even when `noReadyItems` is true.
- [x] Add a failing console test in `src/daemon/console.test.ts` proving `wpStart()` uses blocker-aware messaging and refreshes the selected Flight detail with blockers.
- [x] Update `src/daemon/console.ts` so `renderBlockerBanner()` renders concrete held/review/dependency/writer blockers before the generic no-ready message.
- [x] Update `src/daemon/console.ts` so `wpStart()` reports `advanceBlockerMsg(r.blockers)` when no items start and calls `renderFlightDetail(pkgId, r.stall, r.blockers)` for the selected Flight.
- [x] Run the focused console test:
  - `node --import tsx/esm --test src/daemon/console.test.ts`
- [x] Run final gates:
  - `npm run typecheck`
  - `npm test`
  - `node scripts/scope-wall.mjs`
