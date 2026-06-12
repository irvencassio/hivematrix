# W4.1 Directive Autonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design source: `docs/superpowers/specs/2026-06-12-w4-1-directive-autonomy-design.md`

## Task 1: Add Pure Autonomy Contracts and Parser Tests

- [x] Create `src/lib/orchestrator/directive-autonomy.test.ts`.
- [x] First failing test: `extractDirectiveJson()` extracts fenced JSON and reports invalid JSON.
- [x] First failing test: `parseDirectivePlanOutput()` returns normalized tasks with dependency indices and criterion refs.
- [x] First failing test: `parseDirectiveReviewOutput()` normalizes pass/partial/fail plus corrective tasks.
- [x] First failing test: `parseDirectiveRetrospectiveOutput()` returns playbook deltas and access ledger entries.

## Task 2: Implement Pure Autonomy Parser/Normalizer

- [x] Create `src/lib/orchestrator/directive-autonomy.ts`.
- [x] Export parser functions:
  - `extractDirectiveJson`
  - `parseDirectivePlanOutput`
  - `parseDirectiveReviewOutput`
  - `parseDirectiveRetrospectiveOutput`
- [x] Export `normalizeDirectivePlan()` that clamps invalid dependency references and maps `criterionRefs` to known criterion IDs/descriptions.
- [x] Keep this module pure except for later explicit playbook write helpers.

## Task 3: Add Planner Fallback Tests Around Directive Engine

- [x] Extend `src/lib/orchestrator/directive-engine.test.ts`.
- [x] Failing test: valid autonomy plan creates multiple tasks with `directiveDagIndex`, `dependsOnDagIndices`, and `criterionIds` in task output.
- [x] Failing test: invalid autonomy plan falls back to deterministic one-task-per-open-criterion.
- [x] Failing test: journal includes `task_dag_planned` when an autonomy plan is accepted and `planning_fallback` when rejected.

## Task 4: Integrate Plan Phase With Injectable Planner

- [x] Update `src/lib/orchestrator/directive-engine.ts`.
- [x] Add an internal injectable planner hook for tests, e.g. `_setDirectivePlannerForTests`.
- [x] In `planRun()`, ask the planner for structured output when available.
- [x] Parse and normalize the plan via `directive-autonomy.ts`.
- [x] Create planned tasks with run/DAG metadata.
- [x] Preserve existing deterministic fallback behavior exactly when the planner is unavailable or invalid.

## Task 5: Add Review Gate Tests

- [x] Extend `src/lib/orchestrator/directive-engine.test.ts`.
- [x] Failing test: completed execution tasks do not prove criteria until review returns `pass`.
- [x] Failing test: review `partial` with corrective tasks creates corrective tasks and returns the run to `execute`.
- [x] Failing test: review journal captures review status, findings, gaps, and corrective task IDs.

## Task 6: Implement Review Gate

- [x] Update `src/lib/orchestrator/directive-engine.ts`.
- [x] Add injectable reviewer hook for tests, e.g. `_setDirectiveReviewerForTests`.
- [x] In `verifyRun()`, call reviewer when available.
- [x] On review `pass`, mark open criteria proven as before.
- [x] On review `partial`/`fail` with corrective tasks, create corrective tasks and move back to `execute`.
- [x] On invalid/missing review, keep deterministic verifier fallback for compatibility.

## Task 7: Add Retrospective Learning Tests

- [x] Add tests for retrospective parser and playbook write helper under temp `HOME`/brain root.
- [x] Failing test: retrospective playbook deltas append to role/project playbook files.
- [x] Failing test: access ledger entries upsert into a project access file.
- [x] Failing test: reflect journal records written playbook/access-ledger paths.

## Task 8: Implement Retrospective Learning

- [x] Add constrained playbook/access-ledger helpers in `src/lib/orchestrator/directive-autonomy.ts` or a dedicated `directive-playbooks.ts`.
- [x] Update `reflectAndYield()` to call an injectable retrospective hook when available.
- [x] Write deltas only under the configured brain root.
- [x] Journal `retrospective_recorded` with written paths.
- [x] Preserve current reflection text and directive re-arm behavior.

## Task 9: Verification and Handoff

- [x] `npm run typecheck`
- [x] Focused directive tests:
  `node --import tsx/esm --test src/lib/orchestrator/directive-autonomy.test.ts src/lib/orchestrator/directive-engine.test.ts`
- [x] `npm test`
- [x] `node scripts/scope-wall.mjs`
- [x] `git diff --check`
- [x] Update `/Users/irvencassio/_GD/brain/2026-06-12-hivematrix-auto-update-setup.html`.
- [x] Update `/Users/irvencassio/_GD/brain/projects/hive/plans/2026-06-12-hivematrix-commercial-workplan.md`.
