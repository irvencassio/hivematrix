# Running Task Reply Suppression Design

## Context

The task detail panel currently renders the Reply section for any task with a pending question or a retryable status unless the task is in `needs_input`. For an active `in_progress` run, the panel also renders the always-open Steer section. This creates two text inputs while the task is running: Steer and Reply.

The requested behavior is: when a task is running, remove the Reply button and Reply input. The visible controls should be Cancel, Delete, and Steer with the Steer text box.

## Approaches Considered

1. Guard Reply rendering for `in_progress` tasks.
   - Pros: Minimal, matches the existing `steerable` state, keeps all finished-task and `needs_input` reply behavior intact.
   - Cons: Backlog and assigned tasks are still treated by the older running/action logic if they gain pending questions before becoming steerable.

2. Guard Reply rendering for all `running` statuses (`backlog`, `assigned`, `in_progress`).
   - Pros: Broad interpretation of "running."
   - Cons: Broader behavior change than the screenshot shows, and `backlog`/`assigned` do not have Steer available, so the panel could lose Reply without gaining the intended Steer path.

3. Move action visibility into a separate task-session view model.
   - Pros: Stronger long-term boundary for UI rules.
   - Cons: Too much refactor for a targeted console tweak.

## Decision

Use approach 1. Treat "task is running" as the active live run state where `steerable` is true (`status === "in_progress"`). In that state:

- Show Cancel.
- Show Delete.
- Show the open Steer section and its text box.
- Do not show the Reply toggle.
- Do not render the Reply section, Reply text box, Reply attachments, or Reply button.

The existing `needs_input`, failed, review, and cancelled Reply behavior remains unchanged.

## Components

- `src/daemon/console.ts`
  - Update `taskActionsHtml(t)` so Reply controls are only rendered when `!steerable`.
  - Keep the existing Steer behavior and draft preservation untouched.

- `src/daemon/console.test.ts`
  - Add a string-level regression test that asserts the console script gates `canReply` and Reply-section rendering behind `!steerable`.
  - Keep existing tests for `needs_input` and retryable Reply behavior.

## Testing

Use TDD:

1. Add the failing console test first.
2. Run the targeted test file and confirm the new test fails.
3. Apply the minimal render guard.
4. Run the targeted test file and confirm it passes.
5. Run required repo gates except build, per the request:
   - `npm run typecheck`
   - `npm test`
   - `node scripts/scope-wall.mjs`

No local-model readiness gate is required because this change does not touch local-model code.
No build command should run for this request.
