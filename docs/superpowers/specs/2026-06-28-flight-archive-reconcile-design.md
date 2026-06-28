# Flight Archived Child Reconciliation Design

Date: 2026-06-28
Status: approved for narrow hotfix

## Context

Flights advance by reconciling each running item with its linked board task. The
task board can archive terminal tasks to declutter the UI, but Flight
reconciliation did not map `archived` to any Flight item state.

## Problem

If a linked child task is archived while its Flight item still says `running`,
`Advance` has nothing eligible to start and the item stays `running` forever.
The operator sees a Flight that appears active even though there is no real work
in progress.

## Decision

Treat an archived linked task as a completed Flight item (`done`). Archiving is
available only after terminal/review task states and is an operator cleanup
action, so for Flight rollup it means the item has landed and should not keep
blocking dependencies or deletion.

## Acceptance Criteria

- A running Flight item linked to an archived task reconciles to `done`.
- A Flight with only archived linked children rolls up to `done`.
- `Advance` is no longer a silent no-op for archived child tasks.
- Existing task status mappings remain unchanged.
