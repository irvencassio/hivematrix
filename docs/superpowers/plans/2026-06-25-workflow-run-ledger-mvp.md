# Workflow Run Ledger MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-workflow-run-ledger-mvp-design.md`. Builds on `c9f6ef4`.

## Task 1 — Schema migration [TDD]
- [ ] RED: a schema test asserts `workflow_runs` + `workflow_run_events` columns.
- [ ] GREEN: append additive migration (workflow_runs + workflow_run_events + indexes) to `src/lib/db/index.ts`.

## Task 2 — Run store [TDD]
- [ ] RED: `src/lib/workflows/runs.test.ts` — create validates workflowId (throws unknown); create/get/list/update (terminal→completedAt)/events; metadata + artifacts redacted; rowid tiebreak.
- [ ] GREEN: `src/lib/workflows/runs.ts` — store functions + key-based redactor + findWorkflowRunByDraft.

## Task 3 — HeyGen linkage [TDD]
- [ ] RED: `src/lib/workflows/heygen-run-link.test.ts` — dispatch→portal_pending(+childTaskId); completion→portal_completed/needs_publish_input/failed; publish→done+youtubeUrl artifact.
- [ ] GREEN: `src/lib/workflows/heygen-run-link.ts` — the three link functions (find-or-create by draft).

## Task 4 — Endpoints + console + verify:portal
- [ ] Wire link calls into `/video/heygen-workflow`, `/video/portal-complete`, `/video/publish-draft`; add `GET /workflows/runs`, `GET /workflows/runs/:id`, `GET /workflows/:id/runs`.
- [ ] Console Workflows panel: recent runs (renderWorkflowRuns); source test.
- [ ] Update `src/lib/video/verify-portal-pipeline.ts` to link + assert run transitions (new `run-ledger` phase); update the harness test for the new phase.

## Task 5 — Cleanup + gates + push
- [ ] Tick checkboxes in `docs/superpowers/plans/2026-06-25-workflow-registry-mvp.md`.
- [ ] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`, `npm run verify:portal` green. Commit + push to `main`.
