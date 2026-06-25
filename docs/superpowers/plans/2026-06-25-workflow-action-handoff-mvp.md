# Workflow Action Handoff MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-workflow-action-handoff-mvp-design.md`. Builds on `4533d29`.

## Task 1 — Schema migration [TDD]
- [x] RED: schema test asserts `workflow_actions` columns.
- [x] GREEN: append additive migration (workflow_actions + index) to `src/lib/db/index.ts`.

## Task 2 — Action store [TDD]
- [x] RED: `src/lib/workflows/actions.test.ts` — propose validates target (throws unknown) + redacts suggested inputs; list/get/update; executeWorkflowAction with injected prepare → needs_input on missing required, completed+resultRunId when sufficient.
- [x] GREEN: `src/lib/workflows/actions.ts` — store + `executeWorkflowAction` (dynamic-import prepare).

## Task 3 — Generic prepare dispatcher [TDD]
- [x] RED: `src/lib/workflows/prepare.test.ts` — unknown→unsupported; missing required→needs_input; brief handler dispatches + returns runId.
- [x] GREEN: `src/lib/workflows/prepare.ts` — `prepareWorkflowById`; refactor `/workflows/:id/prepare` endpoint to use it.

## Task 4 — content.research_brief proposes [TDD]
- [x] RED: `content-research.test.ts` — prepare creates a proposed action (target heygen, status proposed, redacted) and does NOT auto-execute (no resultRunId / no heygen task); result exposes the action.
- [x] GREEN: `prepareContentResearchBrief` calls `proposeWorkflowAction`; result includes `proposedAction`.

## Task 5 — Endpoints + console + cleanup + gates
- [x] `GET /workflows/runs/:id/actions`, `GET /workflows/actions`, `POST /workflows/actions/:id/execute`; runs detail returns actions.
- [x] Console "Proposed next actions" + Execute control; source test.
- [x] Tick checkboxes in `docs/superpowers/plans/2026-06-25-content-research-brief-workflow.md`.
- [x] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`, `npm run verify:portal` green. Commit + push to `main`.
