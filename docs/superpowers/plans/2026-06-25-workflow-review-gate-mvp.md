# Workflow Review Gate MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-workflow-review-gate-mvp-design.md`. Builds on `61e2edc`.

## Task 1 — Migration [TDD]
- [ ] RED: schema test asserts new review columns on workflow_runs + source_artifact_map on workflow_actions.
- [ ] GREEN: additive migration (ALTERs) in `src/lib/db/index.ts`.

## Task 2 — Review + revise in runs store [TDD]
- [ ] RED: `src/lib/workflows/runs.test.ts` — reviewWorkflowRun (approve/request_changes/reject → status + decision + scrubbed note + event); reviseWorkflowRunArtifact (scrub, _original kept, event, only that key); isWorkflowRunApproved / isWorkflowRunReviewBlocked.
- [ ] GREEN: review/revise/predicate fns + record fields in `runs.ts`.

## Task 3 — Gate + sourceArtifactMap in actions [TDD]
- [ ] RED: `src/lib/workflows/actions.test.ts` — execute from blocked source run → review_required (no dispatch); approved unlocks; sourceArtifactMap pulls fresh artifact value over stale suggested.
- [ ] GREEN: `proposeWorkflowAction` sourceArtifactMap; `executeWorkflowAction` review gate + fresh-input resolution; result type `review_required` + sourceRunId.

## Task 4 — Script handoff + chain [TDD]
- [ ] RED: `video-script.test.ts` — HeyGen proposal has sourceArtifactMap + "requires approval" reason; update `content-research.test.ts` chain to approve gates + assert revised script used.
- [ ] GREEN: `video-script.ts` proposal (sourceArtifactMap, reason).

## Task 5 — Endpoints + console + cleanup + gates
- [ ] `POST /workflows/runs/:id/review`, `POST /workflows/runs/:id/artifact` (allowlist); execute enforces the gate.
- [ ] Console: editable script + Save revision + Approve/Request changes/Reject; source test.
- [ ] Tick checkboxes in `docs/superpowers/plans/2026-06-25-script-draft-workflow-mvp.md`.
- [ ] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`, `npm run verify:portal` green. Commit + push to `main`.
