# Workflow Registry MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-workflow-registry-mvp-design.md`. Builds on `a10c06a`.

## Task 1 — Registry contracts + HeyGen workflow [TDD]
- [x] RED: `src/lib/workflows/registry.test.ts` — duplicate ids throw; HeyGen def fields (readiness.required + siteId, six handoffs, domains, runbook); match by domain + phrase; no secrets.
- [x] GREEN: `src/lib/workflows/registry.ts` (contracts, normalize, createWorkflowRegistry, getWorkflowRegistry, summarizeWorkflow) + `src/lib/workflows/heygen-portal.ts` (HeyGen def, handler marker) + BUILTIN_WORKFLOWS.

## Task 2 — COO/model visibility [TDD]
- [x] RED: `src/lib/coo/dispatch.test.ts` — dispatch result `workflow.id` for app.heygen.com; `lane-tools.coo.test.ts` — formatCooDispatchResult surfaces the workflow.
- [x] GREEN: additive `workflow` on `CooDispatchResult` from `registry.match`; render in `formatCooDispatchResult`; routing-guide line mentions workflows.

## Task 3 — APIs + console + cleanup + gates
- [x] `GET /workflows`, `GET /workflows/:id`, `POST /workflows/:id/prepare` (HeyGen) in `src/daemon/server.ts`.
- [x] Workflows panel in `src/daemon/console.ts` (Lanes tab) + source test `scripts/workflows-console.test.mjs`.
- [x] Tick checkboxes in `docs/superpowers/plans/2026-06-25-heygen-portal-pipeline-verification.md`.
- [x] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`, `npm run verify:portal` green. Commit + push to `main`.
