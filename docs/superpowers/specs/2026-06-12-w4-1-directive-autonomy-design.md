# W4.1 Directive Autonomy Design

## Context

W4.1 is the Sprint 4 centerpiece: move HiveMatrix directives from a deterministic
one-task-per-criterion runner into an autonomous planning loop with strategy,
task DAG planning, review, and retrospective learning.

Current HiveMatrix state:

- `src/lib/orchestrator/directive-engine.ts` already owns a resumable run loop:
  `plan -> execute -> verify -> reflect -> done/failed`.
- `runs` and `run_journal` already provide the recovery surface. The engine can
  resume after daemon restart by reading active runs.
- `directive_criteria` is the completion truth layer. Criteria are only marked
  proven in the verify phase.
- `planRun()` is intentionally deterministic today and is the replacement seam.
- Existing tests in `src/lib/orchestrator/directive-engine.test.ts` prove the
  deterministic lifecycle and should remain green while W4.1 expands behavior.

Hive 1 source worth porting by design, not wholesale:

- `~/Hive/src/lib/orchestrator/mission-engine.ts`
  - autonomous phases: `strategy -> planning -> execution -> review -> retrospective`
  - phase tasks for CEO/COO style thinking
  - corrective-task loop when review finds gaps
  - failure escalation/replan patterns
- `~/Hive/src/lib/orchestrator/mission-prompts.ts`
  - structured JSON prompts for strategy, planning, review, retrospective
- `~/Hive/src/lib/orchestrator/mission-output-parser.ts`
  - fenced JSON extraction and typed parse helpers
- `~/Hive/src/lib/orchestrator/playbooks.ts`
  - role/project playbook deltas and access ledger writes

## Goals

1. Keep directives as the single HiveMatrix autonomy primitive. Do not re-create
   Hive 1 Missions.
2. Add LLM-driven planning while preserving the existing run recovery model.
3. Create a real task DAG from directive criteria and goal context.
4. Add review before criteria can be proven.
5. Add retrospective learning that writes durable playbook/access-ledger updates
   into the brain tree.
6. Keep local/offline posture honest: think phases use routed model policy, so
   cloud-only work is queued/degraded according to the connectivity layer.

## Non-Goals

- No UI redesign in the first slice.
- No new mission tables.
- No direct LinkedIn/content pipeline behavior in W4.1.
- No complete Hive 1 mission artifact renderer in the first slice.
- No unchecked direct write to arbitrary brain paths. Retrospective writes must
  go through a constrained playbook/access-ledger helper.

## Design Options

### Option A: Port Hive 1 mission engine almost directly

Add mission-like columns to directives/runs, copy phase task concepts, and keep
phase output blobs on the run.

Pros:

- Fast conceptual port from known code.
- Retains Hive 1's CEO/COO separation closely.

Cons:

- High risk of dragging old Mission assumptions into HiveMatrix.
- More schema churn.
- Harder to keep directive criteria as the only completion truth.

### Option B: Add a directive autonomy module beside the current engine

Create `directive-autonomy.ts` for prompts, parser, DAG normalization, review
decisions, and retrospective learning. `directive-engine.ts` stays the state
machine and calls into this module during existing phases.

Pros:

- Preserves the current run loop.
- Lets tests target pure planning/review decisions without booting agents.
- Keeps schema additions minimal by storing rich phase output in `run_journal`.
- Easier to ship in small TDD slices.

Cons:

- Phase state names remain coarse (`plan`, `execute`, `verify`, `reflect`) unless
  journals encode subphase state carefully.
- A later UI may want richer run phase status.

### Option C: Introduce explicit run subphases

Add new run phases such as `strategy`, `planning`, `execute`, `review`,
`retrospective`, then migrate the engine around them.

Pros:

- Most transparent operationally.
- Console/mobile can show exact phase without parsing journal.

Cons:

- Larger migration and test blast radius.
- Existing lifecycle tests and assumptions change at once.
- More work before any user-visible autonomy benefit.

## Recommendation

Use Option B first.

W4.1 should be implemented as a series of small, test-first slices:

1. Pure contracts and parsers.
2. Planner prompt/build/parse to normalized task specs.
3. Engine integration for plan -> task DAG while retaining deterministic fallback.
4. Review phase that gates criterion proof.
5. Retrospective phase that writes playbook/access-ledger updates.
6. Failure escalation/replan loop.

This gives HiveMatrix the Hive 1 autonomy behavior while keeping the directive
state machine stable. If the UI later needs exact subphase display, add run
subphase metadata or explicit phases after the behavior is proven.

## Proposed Architecture

### New Module: `src/lib/orchestrator/directive-autonomy.ts`

Responsibilities:

- Build strategy, planning, review, retrospective, and replan prompts for
  directives.
- Parse structured JSON outputs using local equivalents of Hive 1 parser
  helpers.
- Normalize planner output into safe task specs:
  - title
  - description
  - agent profile/type
  - dependency indices
  - criterion references
  - goal index
- Validate DAG references before task creation.
- Decide review result:
  - pass -> eligible criteria can be proven
  - partial/fail with corrective tasks -> create corrective tasks and return to
    execute
  - partial/fail without corrective tasks -> block/re-arm according to policy
- Convert retrospective JSON into playbook deltas and access ledger writes.

### Engine Integration

Keep `directiveTick()` as the only run lifecycle entrypoint.

First implementation slice:

- Replace deterministic `planRun()` internals with:
  1. collect directive, open criteria, run/journal context
  2. call a routed think-role planner
  3. parse/normalize task DAG
  4. create tasks with `directiveId`, `runId`, and dependency metadata in output
  5. journal `strategy_planned` / `task_dag_planned`
  6. fall back to deterministic planning if the think call fails or returns
     invalid JSON

Later slices:

- `verifyRun()` becomes review-gated:
  - collect task outputs
  - call review prompt
  - if pass, mark matching criteria proven
  - if gaps, create corrective tasks and move to execute
- `reflectAndYield()` becomes retrospective-aware:
  - call retrospective prompt
  - append playbook deltas and access ledger updates
  - journal written paths

### Data Storage

Avoid new tables in the first slice.

Use `run_journal` payloads for:

- strategy output
- plan output
- normalized DAG
- review output
- corrective tasks
- retrospective output
- playbook write paths

Use task `output` metadata for per-task execution linkage:

```json
{
  "runId": "run_...",
  "routedTier": "local",
  "directiveDagIndex": 0,
  "dependsOnDagIndices": [],
  "criterionIds": ["crit_..."]
}
```

If task-level dependencies become first-class later, migrate this metadata into
a proper column/table. For W4.1, task descriptions and engine promotion can use
the existing backlog scheduler constraints.

## Routing and Connectivity

Thinking phases use a `think`/manager route:

- `cloud-ok`: frontier model for strategy/review where available.
- `local-only`/`offline`: local Qwen, with frontier-review debt if the run is
  code-critical and later needs cloud review.
- `cloud-only` default model: queue or use frontier only according to current
  routing policy.

Execution tasks continue using role-based routing from existing `routeByRole`.

## TDD Plan Shape

The implementation plan should start with failing tests for:

1. Parser extracts valid strategy/plan/review/retrospective JSON.
2. Invalid planner output falls back to deterministic one-task-per-criterion.
3. Valid planner output creates multiple directive tasks with stable run/DAG
   metadata and journals the normalized plan.
4. Review pass is required before criteria become proven.
5. Review partial creates corrective tasks and returns the run to execute.
6. Retrospective writes playbook/access-ledger updates under the configured
   brain root.

## Verification Gates

- `npm run typecheck`
- focused directive autonomy tests
- `npm test`
- `node scripts/scope-wall.mjs`
- live daemon smoke:
  - create a directive with three criteria
  - run through plan/execute/review/reflect with stubbed or local-model-safe
    outputs
  - verify journal contains plan/review/retrospective entries

## Approval Ask

Recommended path: Option B, implemented in small TDD slices, with no schema
migration in the first slice and `run_journal` carrying phase artifacts.

After approval, write the implementation plan at:

`docs/superpowers/plans/2026-06-12-w4-1-directive-autonomy.md`
