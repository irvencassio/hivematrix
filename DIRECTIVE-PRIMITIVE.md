# HiveMatrix Directive Primitive

Date: 2026-06-11
Status: Phase 0 data-model spec — implemented in `src/lib/db/index.ts`
Replaces: Mission as the long-horizon autonomy primitive (Q6 decision)

## Why not Mission

Mission carried Hive 1 baggage: budget/cost theater, weak restart recovery, status inflation, and a planning model that conflated "the goal" with "the run." The Directive is designed from first principles: HiveMatrix works toward standing objectives 24x7, survives restarts and usage windows, proves its progress, and knows when it is done.

## Three layers

```
Directive (standing objective; lives weeks/months)
   └─ Run (one execution episode of the loop; lives minutes/hours)
        └─ Task (unit of work; unchanged primitive)
```

## Directive fields (table: `directives`)

| Field | Type | Notes |
|-------|------|-------|
| `goal` | TEXT | Plain-language objective |
| `triggerPolicy` | TEXT JSON | `{type: 'schedule'\|'watcher'\|'dependency'\|'manual'\|'continuous', ...}` |
| `budgetPolicy` | TEXT JSON | Per-run and rolling frontier token/spend caps; exhaustion behavior |
| `approvalPolicy` | TEXT JSON | Which action classes auto-approve vs queue |
| `brainSelection` | TEXT JSON | Pinned brain doc paths |
| `status` | TEXT | `active \| sleeping \| blocked \| done \| retired` |
| `lastRunId` | TEXT | FK → runs._id |
| `nextRunAt` | TEXT | ISO8601, set by scheduler |

**Done = all successCriteria proven** (stored in `directive_criteria` table). A directive cannot self-report done.

## Run (table: `runs`)

One episode of the autonomy loop. The recoverable unit.

1. **Plan** — `think`-role model reviews directive state: open criteria, last reflection, new events. Produces bounded plan (max N tasks).
2. **Execute** — spawn tasks through the normal task engine (routing, approvals, harnesses unchanged).
3. **Verify** — run provers for any criteria the tasks claim to advance. Only prover results mutate criteria state.
4. **Reflect** — structured reflection appended to directive log, surfaced to next run's planner.
5. **Yield** — re-arm per trigger policy, or sleep/block.

Runs journal every step in `run_journal` (step-by-step SQLite log). On daemon restart: incomplete runs resume at the last journal entry — orphaned tasks re-attached or cancelled, then the run resumes at Verify. This is the kill-test target for Phase 5.

## Directive criteria (table: `directive_criteria`)

Each row is one success criterion. Fields: `description`, `proverId` (FK to artifact or probe), `proverType` (`test|probe|artifact`), `proven` (0/1), `provenAt`. A criterion closes only when a prover result sets `proven=1` — the daemon's verify step is the only writer.

## Task lineage

Tasks have `directiveId TEXT` FK (added in db migration v10) and the verified-completion ledger fields: `completedBy`, `proverType`, `completionNote`. Standalone tasks (no directive) remain fully supported.

## 24x7 operation

24x7 is not a property of any one directive. It is the daemon scheduler interleaving directives under global policy: connectivity policy gates what can run, usage-window state decides frontier vs local per role, quiet-hours and concurrency caps bound load, and approval queues hold rather than block the rest.
