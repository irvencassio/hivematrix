# Flight Auto-Land Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Add a failing backend test in `src/lib/work-packages/orchestrate.test.ts` showing `tickWorkPackages()` reconciles a package whose status is already `review` and whose low-risk child task is cleanly in `review`.
- [x] Add a failing console test in `src/daemon/console.test.ts` asserting clean low-risk review items are treated as auto-land pending and do not render the `Accept / Land` button.
- [x] Update `src/lib/work-packages/orchestrate.ts` so `tickWorkPackages()` advances both `running` and `review` packages without duplicating package IDs.
- [x] Update `src/daemon/console.ts` so `flightItemActions()` only renders `Accept / Land` when `_computeReviewReasonJs()` returns a manual-review reason; otherwise render a muted auto-land pending note.
- [x] Run the focused tests:
  - `node --import tsx/esm --test src/lib/work-packages/orchestrate.test.ts`
  - `node --import tsx/esm --test src/daemon/console.test.ts`
- [x] Run final gates:
  - `npm run typecheck`
  - `npm test`
  - `node scripts/scope-wall.mjs`
