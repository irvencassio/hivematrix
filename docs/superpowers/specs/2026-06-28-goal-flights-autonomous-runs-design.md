# Goal Flights Autonomous Runs Design

Date: 2026-06-28
Status: proposed
Extends:
- docs/superpowers/specs/2026-06-27-main-screen-flights-ux-design.md
- docs/superpowers/specs/2026-06-27-flight-loops-quality-passes-design.md
- docs/superpowers/specs/2026-06-28-flight-loop-enhancements-design.md

## Context

Flights are the visible operator concept for staged autonomous work. They already
represent a collection of child tasks, progress, status, and review controls. The
next product step is to support a different shape of work: one broad goal that
may need hours of planning, execution, verification, follow-up tasks, and quality
passes before it is truly complete.

Example: "Create me a web site to do x, y, and z." This should not require the
operator to manually split the request into ten tasks or repeatedly press
Advance. HiveMatrix should keep working autonomously until the goal is landed,
blocked by a real gate, failed with evidence, or paused by the operator.

## Recommendation

Implement this as a new Flight profile, not a new top-level object.

- A **Task** remains one worker run.
- A **Flight** is the durable autonomous goal container.
- A **Goal Flight** is a Flight whose source of truth is a single broad
  objective and explicit success criteria, with dynamic planning and loop-driven
  follow-up item creation.
- A **Loop** is the Flight's quality engine. It wakes after events or on cadence,
  reviews evidence against the goal, creates follow-up items, and decides whether
  to continue, hold, fail, or land.

## Product Model

### Checklist Flight

Existing behavior: a staged collection of known items. Good for release runs,
small task batches, and operator-authored lists.

### Goal Flight

New profile: one durable goal plus dynamic items.

Fields:
- `flightKind`: `checklist` or `goal`.
- `goal`: the user-facing objective.
- `successCriteria`: operator-visible criteria that define "landed".
- `constraints`: project, safety, deployment, credential, UX, and quality limits.
- `loopProfile`: default `goal_quality`.
- `autonomy`: default `autonomous_until_blocked`.

The database can initially store these fields in `intake_json` to avoid a schema
migration. A later migration may promote them to first-class columns.

### Goal Flight Loop

Default policy:
- mode: `self_paced`;
- profile: `goal_quality`;
- max passes: 6 for MVP;
- auto-create follow-up items: true;
- auto-ready safe items: true only when no same-project writer is active and the
  item is low-risk;
- stop at external credentials, destructive changes, deploy/sign/notarize gates,
  unclear product decisions, or repeated failure.

The loop should not run forever. It should either land, block, fail with a clear
reason, or expire.

## UX

### Staging

The New Task route selector should make the broad autonomous path clear:

- Task: one direct run.
- Flight: staged checklist.
- Goal Flight: one outcome, autonomous planning and looped execution.

The classifier may suggest Goal Flight when the prompt is broad, outcome-based,
and contains multiple product requirements without an explicit item list.

### Flight Detail

Goal Flights use the same Flight detail page, with a Goal Summary section above
items:

- Goal
- Success criteria
- Current plan
- Last pass summary
- Next wake / stop reason
- Evidence checklist

The action row should keep Start, Pause, Resume, Run pass, and Advance/Repair.
Advance is a manual repair/nudge, not the normal engine.

### Progress

Progress for Goal Flights should not rely only on done item count. Show both:

- item progress: landed / total items;
- goal confidence: `planning`, `building`, `verifying`, `polishing`, `ready to
  land`, `blocked`, or `landed`.

The MVP can derive these from item/pass status without adding a new confidence
model.

### Landing

A Goal Flight lands only when:
- all non-skipped items are terminal;
- configured gates pass;
- loop review finds no necessary follow-up items;
- final evidence is stored in the latest pass summary;
- no held approval gates remain.

If some items were intentionally archived/skipped, land as `done_with_skips`.

## Autonomy Rules

Goal Flights are autonomous by default within safety gates.

Allowed without approval:
- non-destructive code edits inside the selected project;
- tests, typecheck, lint, scope-wall;
- local builds;
- local screenshots and UI verification;
- creating follow-up Flight items;
- starting low-risk follow-up items when same-project concurrency allows.

Require approval or hold:
- destructive file/database operations;
- force push, reset, clean, or deleting user data;
- production deploys, signing, notarization, uploads, and app store submissions
  unless the operator has explicitly requested that release lane;
- credentials, payments, purchases, external account changes;
- ambiguous product decisions that would materially change scope.

## Backend Semantics

MVP backend changes:
- Preserve existing `/work-packages` routes.
- Accept `intake.goalFlight` metadata when creating a package.
- Add helper accessors that classify a package as `goal` from intake metadata.
- Ensure default loop creation chooses `goal_quality` for Goal Flights.
- Let pass execution inspect success criteria and create follow-up items.
- Add a watchdog result when a Goal Flight is running but has no active work,
  no eligible items, and no scheduled pass.

## iOS Semantics

iOS should decode unknown metadata safely and show Goal Flights without needing a
new API version:
- display a compact Goal section when `intake.goalFlight` exists;
- show loop/pass status when endpoints are available;
- keep Start/Pause/Resume/Run pass/Advance controls consistent with desktop;
- label Goal Flights distinctly in the Board list.

## Acceptance Criteria

- [ ] A broad one-objective prompt can be staged as a Goal Flight.
- [ ] Goal Flight metadata is persisted and returned by Flight detail APIs.
- [ ] Default Goal Flights receive a bounded self-paced loop.
- [ ] A Goal Flight can create follow-up items from a pass.
- [ ] Safe follow-up items can proceed autonomously subject to same-project
      writer constraints.
- [ ] The Flight detail UI explains current goal, evidence, next wake, and stop
      reason.
- [ ] Advance is positioned as repair/nudge, not as the required normal path.
- [ ] iOS can view and operate Goal Flights with matching status language.
- [ ] Regression tests cover stage, loop creation, follow-up item creation,
      stall diagnostics, and landing.

## Open Product Questions

- Should Goal Flight be a route selector choice or an automatic classifier
  recommendation under Flight?
- Should max passes default to 3 for all Flights, or 6 for Goal Flights?
- Should auto-ready safe follow-ups ship in MVP, or should MVP create follow-ups
  as ready-only until the operator starts them?
- What is the final user-facing name: Goal Flight, Autonomous Flight, or just
  Flight with mode `Goal`?
