# Flight Auto-Land Needs-Input Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [ ] Add failing predicate coverage in `src/lib/work-packages/orchestrate.test.ts`.
  - Extend the captured `shouldAutoLand` test signature to include an optional `taskReviewState`.
  - Add a test proving low-risk `task.status = "review"` with `taskReviewState = "needs_input"` returns `autoLand: false`.

- [ ] Add failing reconcile coverage in `src/lib/work-packages/orchestrate.test.ts`.
  - Create a low-risk running package item linked to a task with `status = "review"` and `reviewState = "needs_input"`.
  - Run `reconcileWorkPackage`.
  - Assert the item stays `review`.
  - Assert the task stays `review`, not `archived`.

- [ ] Implement the minimal guard in `src/lib/work-packages/orchestrate.ts`.
  - Add `taskReviewState` to `shouldAutoLand`.
  - Return false when `taskReviewState` is present.
  - Pass `task.reviewState` from `reconcileWorkPackage`.

- [ ] Verify.
  - Run the focused orchestration test file.
  - Run `npm run typecheck`.
  - Run `npm test`.
  - Run `node scripts/scope-wall.mjs`.

- [ ] Commit only the guard, tests, and this Superpowers documentation.
