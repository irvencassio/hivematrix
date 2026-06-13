# W4.1 Failure Replan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Context

W4.1 phase 2 created production planner, reviewer, and retrospective phase tasks. This slice adds the missing failure-context replan loop: execution failures should create a resumable replanner task before the run reaches verification.

## Constraints

- Keep Directives as the only autonomy primitive.
- Do not add a mission/replan table or new run phase.
- Use Task rows with `output.directivePhase` metadata.
- Keep execution phase tasks out of execution-task completion checks.
- Preserve fallback behavior: failed/invalid replans must not hang the run.
- Follow TDD: failing test first, then minimal production code.

## Tasks

- [x] Add failing tests for execution-failure replan.
  - File: `src/lib/orchestrator/directive-engine.test.ts`
  - Test production path:
    - Create a directive with one criterion.
    - Start the production planner phase task, complete it with a one-task plan, and move to `execute`.
    - Mark that execution task `failed`.
    - Tick `execute`; assert the run stays in `execute`, creates a phase task with `output.directivePhase = "replanner"`, and journals `replan_task_started`.
    - Complete the replanner with valid fenced plan JSON; tick; assert a new execution task is created, the replanner is consumed, and journal includes `replanned`.
  - Test fallback path:
    - Complete the replanner with invalid output or failed status.
    - Tick; assert the run moves to `verify` and journals `replan_fallback`.

- [x] Implement replanner phase-task support.
  - File: `src/lib/orchestrator/directive-engine.ts`
  - Extend `DirectivePhaseTaskKind` with `"replanner"`.
  - Mark accepted planner and replanner phase tasks consumed with `directivePhaseConsumedAt`.
  - Add `buildReplannerPrompt()` including directive goal, unproven criteria, all execution task statuses, failed task ids, and required plan JSON shape.
  - Add `hasExecutionFailures()` and `handleExecutionFailures()` helpers.
  - In `advanceExecuting()`, after all execution tasks are terminal:
    - if any failed, create/wait/consume a replanner task;
    - valid plan creates execution tasks and keeps phase `execute`;
    - invalid/failed/missing output journals fallback and advances to `verify`.

- [x] Update continuity docs and commercial workplan.
  - Files:
    - `/Users/irvencassio/_GD/brain/2026-06-12-hivematrix-auto-update-setup.html`
    - `/Users/irvencassio/_GD/brain/projects/hive/plans/2026-06-12-hivematrix-commercial-workplan.md`
  - Record W4.1 phase-3 status, files changed, tests run, and remaining W4.1 scope.

- [x] Run verification gates and finish.
  - `npm run typecheck`
  - `npm test`
  - `node scripts/scope-wall.mjs`
  - `git diff --check`
  - Commit and push only W4.1 failure-replan files plus the updated brain/workplan docs.
