# Flight Auto-Land Needs-Input Guard Design

## Context

HiveMatrix Flight work packages can auto-land low-risk child tasks when they reach `review` cleanly. Live monitoring on 2026-06-30 found a child task that asked for operator approval with `reviewState = "needs_input"` and an "Awaiting your reply" summary, but the package item still auto-landed to `done` because the guard only inspected `task.status`.

## Problem

`task.status = "review"` alone does not mean the child is cleanly complete. The orchestrator also records decision state in `task.reviewState`. Any non-null review state means the child is waiting for a person, parent coordinator, or follow-up decision and must not be auto-accepted.

## Decision

Extend the auto-land predicate to accept the linked task review state. Auto-land remains allowed only when:

- item risk is low
- task status is exactly `review`
- task review state is null or absent
- the item has no blocker
- the item is not final-gated
- the loop profile permits auto-land

`reconcileWorkPackage` will pass the linked task's `reviewState` into the predicate before archiving the child task.

## Scope

In scope:

- regression tests for `status = "review"` plus `reviewState = "needs_input"`
- predicate-level guard
- reconcile-level guard that leaves the item in `review` and leaves the task unarchived

Out of scope:

- database migrations
- changing task review-state production in the agent manager
- changing package advance APIs or scheduler concurrency

## Verification

- focused work-package orchestration test must fail before the guard and pass after it
- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`
