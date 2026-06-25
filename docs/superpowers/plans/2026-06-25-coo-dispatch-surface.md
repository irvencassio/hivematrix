# COO Dispatch Model + Operator Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-coo-dispatch-surface-design.md`. Builds on `606e622`.

## Task 1 — Model-facing coo_dispatch tool [TDD]
- [x] RED: `src/lib/orchestrator/lane-tools.coo.test.ts` — `formatCooDispatchResult` per status (no secret leak); `isLaneTool("coo_dispatch")`; tool in definitions w/ required `text`; `executeCooDispatch` w/ injected runner → prepared / created+taskId / never-creates for non-browser.
- [x] GREEN: in `src/lib/orchestrator/lane-tools.ts` add `coo_dispatch` to `LANE_TOOL_CAPABILITY` (browserbee) + `LANE_TOOL_DEFINITIONS` + `CAPABILITY_ROUTING_LINES`; `executeCooDispatch(args, ctx, runner?)` with default loopback runner; exported pure `formatCooDispatchResult`; switch case.

## Task 2 — Operator console surface [TDD-ish source test]
- [x] RED: `scripts/coo-dispatch-console.test.mjs` asserts the Lanes panel HTML has objective/domains/projectPath inputs, Prepare + gated Create buttons, a `/coo/dispatch` call, lane wording (no "Bee"), and no secret-field exposure.
- [x] GREEN: add the COO Dispatch card + `cooDispatchPrepare()` / `cooDispatchCreate()` JS to `src/daemon/console.ts`; render in `renderSettingsLanes` flow.

## Task 3 — Docs/copy + process cleanup
- [x] Canonical-path copy lives in the tool description + routing line (Task 1).
- [x] Tick completed checkboxes in `...coo-dispatch-bridge.md` and `...coo-dispatch-task-creation.md` (doc-only, no behavior change).

## Task 4 — Gates + push
- [x] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs` green. Commit + push to `main`.
