# W4.1 Failure Replan Design

## Context

W4.1 phase 2 made planner, reviewer, and retrospective phases production-backed
through normal Task rows. The remaining W4.1 prover needs a directive run with
interdependent tasks to survive a mid-run failure and produce a new corrective
plan with failure context.

Current behavior:

- `execute` waits until all execution tasks are terminal.
- Failed execution tasks are treated as terminal, then `verify` runs.
- The reviewer can create corrective work, but only after the run reaches
  `verify`.
- The planner task output is not currently marked consumed because the first
  planner is not reused after `plan`.

## Goal

When execution produces failed tasks, the directive engine should replan before
verification. The replan must be resumable, model-backed, and honest about
failure context.

## Non-Goals

- No new run phases in this slice.
- No schema migration.
- No notification/escalation channel in this slice.
- No UI changes.
- No general dependency scheduler rewrite.

## Options

### Option A: Send failed runs straight to reviewer

Keep `execute -> verify` unchanged and rely on the reviewer to create corrective
tasks.

Pros:

- No new phase-task type.
- Existing reviewer corrective loop already works.

Cons:

- The planner never sees raw failure context.
- The workplan specifically asks for replan-with-failure-context.
- Review and planning responsibilities remain blurred.

### Option B: Add a `replanner` phase task inside `execute`

When all execution tasks are terminal and any failed, `advanceExecuting()`
creates or waits for a `replanner` phase task. The task prompt includes failed
task ids/statuses and unproven criteria. Terminal JSON is parsed through the
same plan parser and creates new execution tasks, then the run remains in
`execute`.

Pros:

- Resumable with current Task lifecycle.
- No schema change.
- Clean planner/reviewer separation.
- Directly proves mid-run failure recovery.

Cons:

- Coarse run phase remains `execute`; subphase is visible through task metadata
  and journal entries rather than `runs.phase`.
- Needs consumed markers so repeated failures can create fresh replanner tasks.

### Option C: Add explicit `replan` run phase

Migrate run phases to include `replan` as a first-class state.

Pros:

- Operationally explicit.

Cons:

- Larger migration and UI blast radius.
- Too much for this hardening slice.

## Decision

Use Option B.

Add `directivePhase: "replanner"` tasks and keep the run in `execute` until
replan output has been consumed. Mark accepted planner/replanner phase tasks
with `directivePhaseConsumedAt` so subsequent corrective loops can create fresh
phase tasks.

## Acceptance Criteria

- A failed execution task does not advance directly to `verify`.
- A `replanner` phase task is created with failure context.
- While the replanner is pending, the run remains in `execute`.
- Terminal valid replan JSON creates new execution tasks and journals `replanned`.
- Terminal invalid/failed replan output falls back to `verify` with a
  `replan_fallback` journal entry so the run does not hang forever.
- Existing planner/reviewer/retrospective tests remain green.
