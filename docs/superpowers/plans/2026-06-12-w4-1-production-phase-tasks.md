# W4.1 Production Phase Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Context

W4.1 phase 1 added parser/normalizer support and test-only autonomy hooks for planner, reviewer, and retrospective JSON. Production still falls back to the deterministic planner/reviewer unless tests inject hook text. This phase wires those same JSON contracts to normal HiveMatrix tasks so the scheduler can run them through the existing agent lifecycle and resume safely after restarts.

## Constraints

- Keep Directives as the sole standing-objective primitive.
- Do not add a mission/project-goal table or mission fields.
- Use existing Task rows and scheduler lifecycle for model-backed phase work.
- Mark phase tasks distinctly so execution-task waits never include planner/reviewer/retrospective tasks.
- Preserve deterministic fallback behavior when model-backed phase output is missing, failed, or invalid.
- Follow TDD: add a failing test before production edits for each behavior slice.

## Tasks

- [x] Add failing tests for production planner phase tasks.
  - File: `src/lib/orchestrator/directive-engine.test.ts`
  - Add a helper that filters run tasks by `output.runId`.
  - Test that, without a test planner hook, the plan phase creates exactly one phase task marked `output.directivePhase = "planner"` and keeps the run in `plan`.
  - Complete that phase task with a fenced JSON plan in `output.summary`; tick again; assert execution tasks are created, phase tasks are excluded from execution waits, and the run moves to `execute`.

- [x] Implement planner phase-task creation and output parsing.
  - File: `src/lib/orchestrator/directive-engine.ts`
  - Add `DirectivePhase` / `DirectiveRunTask` helpers.
  - Add `isDirectivePhaseTask()`, `collectRunTasks()` execution filtering, and `findPhaseTask()`.
  - Add `createPhaseTask()` using role route `think`, profile `coo`, source `directive`, executor `agent`, and task output metadata:
    ```ts
    output: {
      runId: run._id,
      directivePhase: "planner",
      directivePhaseFor: "plan",
      routedTier: route.tier
    }
    ```
  - Add `extractTaskText()` that reads final JSON text from `output.summary`, derived turn headline/result text, or trailing text logs.
  - In `planRun()`, create or wait for the planner phase task; when terminal, parse JSON plan, create DAG tasks, and journal phase-task lifecycle. Fall back to deterministic planning on failed/invalid output.

- [x] Add failing tests for production reviewer phase tasks.
  - File: `src/lib/orchestrator/directive-engine.test.ts`
  - Test that verify creates a `reviewer` phase task after execution tasks finish and keeps the run in `verify`.
  - Complete reviewer task with `pass` JSON; tick; assert criteria are proven and the run advances to `reflect`.
  - Test that partial reviewer output with corrective tasks creates corrective execution tasks and returns to `execute`.

- [x] Implement reviewer phase-task creation and output parsing.
  - File: `src/lib/orchestrator/directive-engine.ts`
  - In `verifyRun()`, if no test reviewer hook, create or wait for reviewer phase task.
  - Reviewer prompt must include directive goal, unmet criteria, execution-task statuses, and the required JSON shape.
  - Parse terminal reviewer output with `parseDirectiveReviewOutput()`.
  - Preserve current pass/partial/fail semantics and fallback to the deterministic prover on invalid/missing output.

- [x] Add failing tests for production retrospective phase tasks.
  - File: `src/lib/orchestrator/directive-engine.test.ts`
  - Test that reflect creates a `retrospective` phase task and keeps the run in `reflect`.
  - Complete retrospective task with JSON; tick; assert learning files are written, journal records `retrospective_recorded`, and the run yields.

- [x] Implement retrospective phase-task creation and output parsing.
  - File: `src/lib/orchestrator/directive-engine.ts`
  - In `reflectAndYield()`, if no test retrospective hook, create or wait for retrospective phase task.
  - Retrospective prompt must include directive outcome, reflection text, and required JSON shape.
  - Parse terminal output with `parseDirectiveRetrospectiveOutput()` and write learning through `writeDirectiveRetrospectiveLearning()`.
  - Preserve fallback: invalid/missing output journals a fallback and still yields.

- [x] Update continuity docs and commercial workplan.
  - Files:
    - `/Users/irvencassio/_GD/brain/2026-06-12-hivematrix-auto-update-setup.html`
    - `/Users/irvencassio/_GD/brain/projects/hive/plans/2026-06-12-hivematrix-commercial-workplan.md`
  - Record W4.1 phase-2 status, files changed, tests run, and remaining W4.1 scope.

- [x] Run verification gates and finish branch.
  - `npm run typecheck`
  - `npm test`
  - `node scripts/scope-wall.mjs`
  - `git diff --check`
  - Commit and push only W4.1 phase-2 files plus the updated brain/workplan docs.
