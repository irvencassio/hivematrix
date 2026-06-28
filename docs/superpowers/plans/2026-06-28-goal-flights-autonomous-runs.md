# Goal Flights Autonomous Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design:
- docs/superpowers/specs/2026-06-28-goal-flights-autonomous-runs-design.md

## Guardrails

- Follow AGENTS.md and Superpowers strictly.
- Use TDD: add or update a failing test before production code.
- Preserve existing `/work-packages` route compatibility.
- Do not overwrite active user/agent changes. Inspect `git diff` before editing
  any dirty file.
- Keep deploy/sign/notarize/upload behavior behind existing approval/release
  gates.

## Tasks

- [ ] Add Goal Flight metadata tests.
  - Files:
    - `src/lib/work-packages/store.test.ts`
    - `src/lib/work-packages/store.ts`
  - RED: create a package with `intake.goalFlight` metadata and assert detail
    returns it unchanged.
  - GREEN: preserve metadata through create/list/detail without schema changes.

- [ ] Add Goal Flight default loop tests.
  - Files:
    - `src/lib/work-packages/store.test.ts`
    - `src/lib/work-packages/flight-loop-store.ts`
    - `src/lib/work-packages/store.ts`
  - RED: readying a Goal Flight without a loop creates a self-paced
    `goal_quality` loop with bounded max passes.
  - GREEN: extend default loop creation to select Goal Flight policy from
    intake metadata.

- [ ] Add intake/classifier support for broad one-objective Goal Flights.
  - Files:
    - `src/lib/intake/classify.test.ts`
    - `src/lib/intake/classify.ts`
  - RED: broad outcome prompt such as "create a web site to do x y z" returns a
    work package candidate with `intake.goalFlight`.
  - GREEN: add deterministic signals and metadata while preserving normal task
    behavior.

- [ ] Add pass/follow-up semantics for Goal Flights.
  - Files:
    - `src/lib/work-packages/flight-loop-pass.test.ts`
    - `src/lib/work-packages/flight-loop-pass.ts`
    - `src/lib/work-packages/follow-up-creator.ts`
  - RED: a Goal Flight pass with failed evidence creates follow-up items tied to
    success criteria.
  - GREEN: include goal/success criteria in pass context and evidence.

- [ ] Add stall diagnostics for autonomous Goal Flights.
  - Files:
    - `src/lib/work-packages/orchestrate.test.ts`
    - `src/lib/work-packages/orchestrate.ts`
    - `src/daemon/server.ts`
  - RED: running Goal Flight with no active task, no eligible item, and no next
    loop wake reports an actionable blocker instead of a silent no-op.
  - GREEN: return diagnostics from advance/reconcile without breaking current
    response shape.

- [ ] Update desktop console Goal Flight UX.
  - Files:
    - `src/daemon/console.test.ts`
    - `src/daemon/console.ts`
  - RED: source contains Goal Flight labels/sections and does not imply Advance
    is required for normal autonomous progress.
  - GREEN: show goal metadata, loop status, next wake/stop reason, and
    repair/nudge copy.

- [ ] Update docs and user guide.
  - Files:
    - `docs/superpowers/specs/2026-06-28-goal-flights-autonomous-runs-design.md`
    - `/Users/irvencassio/_GD/brain/hivematrix/flights-user-guide.html`
  - RED: source/doc check expects Goal Flight coverage.
  - GREEN: document Goal Flights as the autonomous long-running mode.

- [ ] Verification gates.
  - Commands:
    - `npm run typecheck`
    - `npm test`
    - `node scripts/scope-wall.mjs`

