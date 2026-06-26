# System Readiness + Result Quality Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-26-system-readiness-result-quality-design.md`

## Task 1 — RED: readiness report tests

- [x] Add `src/lib/system-readiness/index.test.ts`.
- [x] Tests use an isolated `HIVEMATRIX_DB_PATH`.
- [x] Assert empty COO rules produce a warn check.
- [x] Seed a legacy video review task and assert a legacy-video warn check.
- [x] Seed a failed task and assert safe failed-task snippets.
- [x] Inject Browser Lane, Lane Apps, and local model dependencies so tests do not launch apps or probe the network.

## Task 2 — GREEN: read-only readiness report module

- [x] Add `src/lib/system-readiness/index.ts`.
- [x] Define report/check types and severity ordering/counts.
- [x] Implement read-only DB counts for COO rules, failed tasks, and legacy video review tasks.
- [x] Fold in Browser Lane dashboard, Lane Apps state, Workflow Inbox, and cached local model health via injectable deps.
- [x] Redact secret-looking snippets.

## Task 3 — RED: endpoint + console source tests

- [x] Add `scripts/system-readiness-endpoint.test.mjs` asserting `GET /system/readiness` is routed through `getSystemReadinessReport`.
- [x] Add `scripts/system-readiness-console.test.mjs` asserting a System Readiness card, `/system/readiness` fetch, count chips, Refresh button, and no repair/mutation button.

## Task 4 — GREEN: daemon endpoint + console card

- [x] Wire `GET /system/readiness` in `src/daemon/server.ts`.
- [x] Add the System Readiness card at the top of Settings -> Lanes in `src/daemon/console.ts`.
- [x] Add `renderSystemReadiness()` and call it when switching to the Lanes tab.

## Task 5 — Verify and ship

- [x] Focused tests.
- [x] `npm run typecheck`.
- [x] `npm test`.
- [x] `node scripts/scope-wall.mjs`.
- [x] `npm run verify:portal`.
- [ ] Commit and push to `main`.
