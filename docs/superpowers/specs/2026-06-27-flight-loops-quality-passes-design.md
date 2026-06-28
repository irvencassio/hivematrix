# Flight Loops Quality Passes Design

Date: 2026-06-27
Status: proposed

## Context

HiveMatrix already has **Flights**: a visible, staged collection of child tasks
for an autonomous run with light operator control. A Flight can be staged,
edited, started, advanced, and monitored from the main screen. Current
orchestration starts eligible ready items, reconciles child-task status, and
advances the Flight via both a fast task-update hook and a 15-second backstop
loop.

That is enough to execute a known task list, but it is not yet the product
behavior the operator wants: "make a few passes at making enhancements/fixes so
that quality increases." The desired behavior is closer to Claude Code's
session `/loop`: repeatedly wake up, inspect state, continue useful work, and
stop when done or when approval is needed.

HiveMatrix should add a first-class **Flight Loop** layer: a visible, bounded,
reviewable quality-pass runner attached to a Flight.

## Problem

Today a Flight can run child items, but it lacks a quality-improvement loop:

- no explicit "do another pass" concept;
- no cadence or max-pass controls;
- no structured pass history;
- no stop condition beyond item statuses;
- no built-in pass types such as verify, review, fix, polish, and release prep;
- no operator-visible reason for why the loop continued, paused, or stopped.

The result is that a long Flight can finish its initial list without the kind of
iterative cleanup that makes autonomous work feel trustworthy.

## Goals

- Add Flight-level loops that make repeated quality passes over a Flight.
- Keep loops visible and bounded, never an invisible swarm.
- Support manual "Run next pass" and scheduled/self-paced loop modes.
- Let HiveMatrix inspect current state and create follow-up Flight items when
  useful.
- Require approval for risky, destructive, deploy, credentialed, or ambiguous
  work.
- Preserve existing Flight item orchestration and same-repo concurrency safety.
- Record pass history: what was checked, what was created, what changed, why it
  paused or stopped.
- Make this useful for solo-founder/personal work: product polish, bug fixing,
  CI/test repair, UX refinement, release readiness, inbox/personal admin.

## Non-Goals

- Do not replace Flights or Work Package internals with a separate task system.
- Do not auto-run forever.
- Do not bypass existing approval policy.
- Do not trust a model to decide safety, risk, or deployment gates.
- Do not require cloud API keys. Model-advised planning can use the existing
  keyless/local completion path and must fall back deterministically.

## Product Model

### Flight

A Flight remains the parent object: title, description, project, items, status,
progress, and child tasks.

### Flight Item

A Flight Item remains a concrete child task that can be edited, held, readied,
started, linked to a board task, and marked done/failed/review.

### Flight Loop

A Flight Loop is a policy attached to one Flight. It decides whether and when to
run another **Pass**.

Examples:

- "Run up to 4 quality passes, every 10 minutes while active."
- "Self-paced: inspect after each item lands; continue if tests fail or obvious
  improvements remain."
- "Manual only: operator presses Run pass."

### Pass

A Pass is one bounded inspection-and-action cycle. It can:

- reconcile child-task status;
- run configured checks;
- summarize evidence;
- create follow-up Flight items;
- mark items ready/held according to policy;
- pause for approval;
- decide the loop is complete.

A Pass should not be a giant opaque agent run. It should have a visible purpose,
inputs, outputs, and stop reason.

## UX

### Flight Detail

Add a **Loop** section to Flight detail, below the Flight actions and above or
beside the item list depending on available width.

Show:

- Loop mode: Off, Manual, Fixed cadence, Self-paced.
- Pass counter: `2 of 4 passes`.
- Next wake: `in 8m`, `after active item lands`, or `paused`.
- Last pass summary.
- Stop condition.
- Buttons:
  - Run pass
  - Pause loop
  - Resume loop
  - Edit loop

Use compact controls, not a large settings-only panel. The operator should see
the loop status where the Flight work is happening.

### Stage Flight Flow

When a broad prompt stages a Flight, offer an optional loop preset:

- **No loop**: stage items only.
- **Quality passes**: run verify/review/fix passes until clean or max pass count.
- **Release prep**: include stricter gates for tests, build, signing, publish
  proof, and release notes.
- **Watch mode**: periodically inspect external state such as CI, review
  comments, uploads, or inbox outcomes.

Default recommendation: **Quality passes**, max 3 passes, manual start.

### Editing A Loop

Loop editor fields:

- Mode: Off, Manual, Fixed, Self-paced.
- Max passes: default 3, allowed 1-12.
- Cadence: 1m, 5m, 10m, 30m, 1h. Fixed mode only.
- Pass profile: Quality, Release, Watch, Personal admin.
- Checks to run:
  - tests
  - typecheck
  - scope wall
  - git status
  - app/build verification
  - voice diagnostics
  - custom command list
- Auto-create follow-up items: toggle, default on.
- Auto-start safe follow-up items: toggle, default off for MVP.

### Pass History

Each pass row should show:

- pass number;
- started/finished time;
- profile;
- result: clean, added items, failed checks, needs approval, stopped;
- evidence summary;
- created item count;
- link to logs/transcript/artifacts.

This gives the operator confidence that quality increased because the loop found
and worked through concrete evidence.

## Suggested Approaches

### Approach A: Manual Passes First

Add a `Run pass` button only. A pass inspects the Flight, runs checks, and
suggests/creates follow-up items. No scheduling yet.

Pros:

- smallest safe slice;
- easiest to test;
- makes the quality-pass concept visible quickly.

Cons:

- does not feel like Claude `/loop`;
- operator must keep pressing the button.

### Approach B: Attach Scheduled Loops To Flights

Add manual pass plus fixed/self-paced scheduling attached to each Flight.

Pros:

- matches the desired product behavior;
- keeps scheduling scoped to visible work;
- can reuse current Flight reconcile loop as the wakeup mechanism.

Cons:

- needs schema, scheduler state, and careful pause/expiry behavior.

### Approach C: Global Loop Command

Add a command-style global loop independent of Flights, similar to `/loop`.

Pros:

- simple mental model for power users;
- useful for "watch CI" or "keep checking" tasks.

Cons:

- less visible for built-product users;
- risks becoming another hidden automation surface;
- duplicates Flight status/progress.

## Recommendation

Use **Approach B**, implemented in two slices:

1. **Flight Pass MVP**: manual `Run pass`, pass history, checks, follow-up item
   creation, no scheduling.
2. **Flight Loop Scheduling**: fixed cadence and self-paced wakeups, pause/resume,
   max-pass and expiry policy.

This keeps the first slice shippable and testable while pointing directly at the
Claude `/loop` style experience.

## Loop Policy

### Modes

`off`

- No passes run.

`manual`

- Operator presses `Run pass`.
- No scheduled wakeups.

`fixed`

- Run a pass at a configured cadence while the Flight is active.
- Do not interrupt active child tasks; queue the pass for the next safe window.

`self_paced`

- Run after important events:
  - a child item lands;
  - a child item fails;
  - a child item enters review;
  - all currently active items are idle;
  - a watched external check changes.
- The pass decides whether to schedule another pass or stop.

### Bounds

Every loop must have:

- `maxPasses`, default 3;
- `expiresAt`, default 7 days after creation;
- `paused` state;
- stop reason;
- no overlapping passes.

### Stop Reasons

- max passes reached;
- all checks clean;
- no actionable follow-up found;
- waiting for approval;
- waiting for operator input;
- risky action held;
- expired;
- manually paused;
- Flight landed/failed/cancelled.

## Pass Profiles

### Quality

Default for product improvement. Checks:

- reconcile Flight item status;
- inspect failed/review items;
- run configured repo gates when available;
- inspect git status/diff;
- create follow-up items for bugs, polish, missing tests, and UX issues.

### Release

Stricter profile. Checks:

- typecheck;
- tests;
- scope wall;
- build/package;
- release feed or deployed artifact proof when configured;
- held deployment/publish steps require approval.

### Watch

External-state profile. Checks:

- CI status;
- PR review comments;
- TestFlight/App Store processing state;
- GitHub release or update feed propagation;
- scheduled task outcomes.

### Personal Admin

Solo-founder/personal profile. Checks:

- pending approvals;
- failed tasks;
- reminders;
- inbox/briefing state;
- voice diagnostics when relevant;
- creates follow-up admin items without taking destructive actions.

## Pass Execution Pipeline

1. Acquire a per-Flight loop lock.
2. Reconcile the Flight and child tasks.
3. Gather evidence:
   - item statuses;
   - task transcripts/results;
   - configured checks;
   - git/build/test output summaries;
   - optional external-state checks.
4. Classify state deterministically:
   - clean;
   - needs follow-up;
   - blocked;
   - risky/approval required;
   - still running.
5. Ask the decomposition/planning model only for follow-up item wording when the
   feature is enabled and a keyless/local client is available.
6. Apply deterministic policy to any proposed follow-up items:
   - risk stamping;
   - held gates;
   - dependencies;
   - same-repo concurrency.
7. Persist pass record.
8. Broadcast Flight update.
9. Decide next loop state.

## Follow-Up Item Creation

Passes can append items to the Flight. Each generated item must include:

- source pass id;
- evidence summary;
- title;
- prompt;
- risk;
- execution mode;
- status.

Default status:

- `draft` for newly proposed work;
- `held` for risky/destructive/deploy/credentialed work;
- `ready` only when operator has enabled auto-ready for safe follow-ups.

MVP recommendation: create as `draft` and show a `Ready all safe items` action.

## Safety And Approval

The loop may inspect and propose. It may not bypass:

- content approvals;
- external/credentialed approvals;
- stuck-task approvals;
- tool approvals;
- release/deploy/destructive gates;
- same-repo writer concurrency.

Risky generated items are held. The operator must explicitly mark them ready.

The loop should be allowed to auto-run read-only checks, local tests, typecheck,
scope wall, and status inspection when those commands are already normal repo
gates.

## Data Model

Add tables:

```sql
CREATE TABLE flight_loops (
  _id TEXT PRIMARY KEY,
  packageId TEXT NOT NULL,
  mode TEXT NOT NULL,
  profile TEXT NOT NULL,
  status TEXT NOT NULL,
  maxPasses INTEGER NOT NULL,
  passCount INTEGER NOT NULL DEFAULT 0,
  cadenceSeconds INTEGER,
  nextRunAt TEXT,
  expiresAt TEXT,
  autoCreateItems INTEGER NOT NULL DEFAULT 1,
  autoReadySafeItems INTEGER NOT NULL DEFAULT 0,
  stopReason TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE flight_loop_passes (
  _id TEXT PRIMARY KEY,
  loopId TEXT NOT NULL,
  packageId TEXT NOT NULL,
  passNumber INTEGER NOT NULL,
  profile TEXT NOT NULL,
  status TEXT NOT NULL,
  startedAt TEXT NOT NULL,
  completedAt TEXT,
  summary TEXT,
  evidenceJson TEXT,
  createdItemIdsJson TEXT,
  stopReason TEXT,
  error TEXT
);
```

Internal API can still use `/work-packages` paths for compatibility, but
operator-facing copy should say Flight.

## APIs

- `GET /work-packages/:id/loop`
- `PUT /work-packages/:id/loop`
- `POST /work-packages/:id/loop/run-pass`
- `POST /work-packages/:id/loop/pause`
- `POST /work-packages/:id/loop/resume`
- `GET /work-packages/:id/loop/passes`

All APIs return redacted summaries and never expose secret-like command output.

## Scheduler

Add `tickFlightLoops()` next to `tickWorkPackages()`.

It should:

- find active loops whose `nextRunAt <= now`;
- skip loops with an active pass;
- skip expired loops and mark stopped;
- skip Flights in terminal states unless the profile explicitly allows final
  verification;
- run one pass per Flight at a time;
- compute the next run based on mode and pass result.

For self-paced mode, task-update hooks can set `nextRunAt = now` when a child
task lands/fails/reviews, but the scheduler remains the only pass runner.

## Relationship To Existing Flight Orchestration

Existing item orchestration answers: "Which ready item can run now?"

Flight Loop answers: "After seeing what happened, should we make another quality
pass, create more items, pause, or stop?"

They must remain separate:

- item orchestration is deterministic and frequent;
- loop passes are heavier, evidence-based, and bounded;
- loops may append items, but item orchestration starts them only if they are
  ready and policy allows.

## Testing Strategy

Unit tests:

- loop policy computes next run for manual/fixed/self-paced modes;
- max pass and expiry stop loops;
- no overlapping passes;
- pass result creates draft follow-up items;
- risky follow-up item becomes held;
- self-paced event schedules a pass;
- clean pass stops with `all_checks_clean`.

Server tests:

- loop CRUD round-trips;
- run-pass persists pass history;
- pause/resume changes scheduler behavior;
- pass creation broadcasts Flight updates;
- generated items appear in Flight detail.

Console source tests:

- Flight detail includes Loop section;
- Run pass/Pause/Resume/Edit loop controls exist;
- pass history renders;
- no hidden Settings-only loop control.

Integration tests:

- create Flight with two items;
- start it;
- mark first item done;
- self-paced loop schedules a pass;
- pass creates a follow-up item;
- operator marks it ready;
- existing orchestration starts it respecting concurrency.

Verification gates:

- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`

## Implementation Slices

### Slice 1: Manual Flight Pass MVP

- Schema for loops and passes.
- Store and pure policy helpers.
- Manual `run-pass` endpoint.
- Simple Quality profile with repo gate discovery.
- Follow-up item creation as draft.
- Flight detail Loop section and pass history.

### Slice 2: Loop Scheduling

- Fixed cadence mode.
- Self-paced event scheduling from child task transitions.
- Pause/resume.
- Expiry and max-pass stop reasons.
- Scheduler tests.

### Slice 3: Profiles And Presets

- Release profile.
- Watch profile.
- Personal Admin profile.
- Stage Flight loop preset selector.
- Custom command/check list.

### Slice 4: Smarter Follow-Up Planning

- Use existing model-advised decomposition for follow-up item wording.
- Keep deterministic safety policy.
- Add "Regenerate suggestions" and "Accept selected suggestions."

## Acceptance Criteria

- Operator can attach a Quality loop to a Flight from the main screen.
- Operator can run a manual pass and see pass history.
- A pass can create multiple follow-up Flight items from evidence.
- Risky follow-up items are held.
- Fixed/self-paced loops run bounded passes without overlapping.
- Loop status and next wake are visible in Flight detail.
- Loops stop with a visible reason.
- Existing Flight concurrency/gates still apply.
- Full gates pass.

