# Flight Review Reply Reconcile Design

## Problem

A Flight item can stay in `review` after the operator replies to its linked review task. The generic task reply route requeues review tasks by moving the task back to `backlog`, but it does not reconcile the owning Flight item. That leaves a mismatch: the linked task is ready to run again, while the Flight item still blocks advancement as `review`.

## Approach

Keep the current semantics: replying to a review task means "continue/rework this task", not "accept/land it". After the task is requeued, immediately run the same Work Package reconciliation hook used by retry/archive/PATCH paths. Reconciliation maps the linked task's `backlog` state back to a running Flight item and clears stale review blocking so the Flight can keep moving.

Do not change the explicit `Accept / Land` path. That remains the operator action for approving a review item as done.

## Acceptance

- Replying to a work-package child task in `review` requeues the task and reconciles the linked Flight item out of `review`.
- The Flight item follows existing task-status mapping: `backlog`, `assigned`, and `in_progress` map to `running`.
- Existing retry/archive/PATCH behavior remains unchanged.
- Tests prove the reply route updates both task and Flight item state.
