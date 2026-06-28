# Flight Loop Enhancements Design

Date: 2026-06-28
Status: proposed
Extends: docs/superpowers/specs/2026-06-27-flight-loops-quality-passes-design.md

## Context

Slices 1 and 2 of the Flight Loop feature are complete. The system now supports:

- Manual and self-paced pass execution.
- Quality profile with repo gate discovery, evidence gathering, and follow-up item creation.
- Atomic pass locking, pass history, stop reasons, and scheduler heartbeat.

Five gaps prevent the loop from being the default operator experience:

1. No loop is created when a Flight is staged — the operator must navigate to
   Loop settings and configure one manually.
2. Items archived at the task level are silently counted as "done" in evidence,
   erasing the distinction between genuine completion and work that was skipped.
3. Pass status has no "skipped" value, so a pass that fires but cannot act (e.g.
   Flight still in draft/held) leaves no visible record.
4. Post-run evidence omits loop mode, archived item count, and gate discovery
   results — enough to read a single pass but not enough to trend across passes.
5. The `release`, `watch`, and `personal_admin` profiles are stored and displayed
   but execute identical quality-profile logic.

This document specifies the desired semantics, risks, and acceptance criteria
for each enhancement before any production code is written.

---

## Enhancement 1: Default Self-Paced Quality Loop

### Current Behavior

`readyWorkPackage()` in `src/lib/work-packages/store.ts` transitions the Flight
from `draft` → `ready`. No loop is created. The operator must call
`PUT /work-packages/:id/loop` to attach a loop.

The design doc recommends "Quality passes, max 3 passes, manual start" as the
Stage Flight default but does not enforce it in code.

### Desired Semantics

When a Flight is readied (`draft` → `ready`), if no loop exists for that
Flight, automatically create a self-paced quality loop with these defaults:

| Field | Default |
|---|---|
| `mode` | `self_paced` |
| `profile` | `quality` |
| `maxPasses` | `3` |
| `autoCreateItems` | `true` |
| `autoReadySafeItems` | `false` |
| `expiresAt` | `now + 7 days` |
| `nextRunAt` | `null` (event-driven, not immediate) |
| `status` | `idle` |

Rules:

- Idempotent: if a loop already exists for the Flight, do not create a second.
- The auto-created loop is fully editable — the operator can change mode, max
  passes, or turn it off (`mode: "off"`) from the Loop section.
- The first pass fires only after the first item event (done, failed, or review).
  A freshly readied Flight with no running items does not immediately pass.
- Flights held at `draft` (e.g. via `held` status) do not receive a loop until
  they are explicitly readied.

### Risks

- An operator who stages a Flight for review only (no autonomous execution) will
  get an unexpected loop. Mitigation: `mode: "off"` is a one-click escape, and
  the Loop section is visible on Flight detail.
- Rapid Flight creation in tests or scripted intake can accumulate idle loops.
  Mitigation: the `expiresAt` TTL cleans them up; idle loops with zero passes
  cost nothing.
- Re-readying a previously cancelled/failed Flight (after a reset) must not
  create a second loop. The idempotency check on `packageId` in `flight_loops`
  (unique index) already enforces this.

### Acceptance Criteria

- [ ] `readyWorkPackage()` creates a self-paced quality loop when none exists.
- [ ] `readyWorkPackage()` does not create a loop if one already exists.
- [ ] The auto-created loop has `status=idle` and `nextRunAt=null`.
- [ ] The loop's first pass fires after the first item event, not immediately.
- [ ] A `held` Flight that bypasses `readyWorkPackage()` does not receive a loop.

---

## Enhancement 2: `skipped` Pass Status and `done_with_skips` Flight Status

### Current Behavior

`PassStatus = "running" | "completed" | "failed"`

`PackageStatus = "draft" | "held" | "ready" | "running" | "review" | "done" | "failed" | "cancelled"`

When the scheduler fires for a loop whose Flight is `draft` or `held`, the
scheduler skips the loop silently (no pass record written). The operator sees no
evidence that a scheduled trigger fired and did nothing.

Similarly, when all Flight items reach terminal state but some were archived (see
Enhancement 3), the Flight rolls up to `done` — indistinguishable from a Flight
where every item was intentionally completed.

### Desired Semantics

**`PassStatus: "skipped"`**

A pass record with `status: "skipped"` is written when a scheduled trigger fires
but cannot execute due to a temporary blocking condition:

- Flight is in `draft`, `held`, or `review` state.
- A pass is already running (lock contention).
- The loop is within its maxPasses but the Flight has no items yet.

A skipped pass:
- consumes NO pass count toward `maxPasses`;
- sets `stopReason: "skipped_flight_not_ready"` | `"skipped_lock_held"` | `"skipped_no_items"`;
- does not affect `passCount` on the loop;
- is visible in pass history with a distinct visual state.

**`PackageStatus: "done_with_skips"`**

The Flight rollup in `rollupStatus()` (`src/lib/work-packages/orchestrate.ts`)
returns `"done_with_skips"` instead of `"done"` when:

- all items are in terminal state (`done`, `failed`, `cancelled`, or `archived`);
- AND at least one item is `archived` (task was archived before completion);
- AND zero items are `failed` (a mix of done + archived, not done + failed).

If any item is `failed`, the Flight rolls up to `failed` regardless of archived.

The scheduler stops a loop whose Flight is `done_with_skips` (same as `done`,
`failed`, `cancelled`).

### Risks

- Adding `"skipped"` to `PassStatus` is additive; existing queries that check
  `status = 'completed'` remain correct.
- Adding `"done_with_skips"` to `PackageStatus` requires updating any UI switch
  or status-chip that enumerates statuses. Must audit the console source for
  exhaustive matches.
- The scheduler step that marks a loop `stopped` on terminal Flight must include
  `done_with_skips` in its terminal-state list.

### Acceptance Criteria

- [ ] A scheduled pass for a `held` Flight writes a skipped pass record with no
  increment to `passCount`.
- [ ] A skipped pass does not trigger follow-up item creation.
- [ ] `rollupStatus()` returns `"done_with_skips"` when all items terminal and
  any are `archived`, none are `failed`.
- [ ] `rollupStatus()` still returns `"done"` when all items are `done` (no
  archived).
- [ ] `rollupStatus()` returns `"failed"` when any item is `failed`, even if
  others are archived.
- [ ] The scheduler stops a loop when Flight is `done_with_skips`.
- [ ] `done_with_skips` Flight detail renders a distinct chip in the console
  source (string check in npm test).

---

## Enhancement 3: Archived Item Transition Coverage

### Current Behavior

`reconcileWorkPackage()` in `src/lib/work-packages/orchestrate.ts` maps task
status to item status via a switch. Case `"archived"` maps to item `"done"` at
line 64. Archived items are therefore counted as `done` in:

- `rollupStatus()` (Flight status rollup);
- pass evidence `counts` (item status histogram);
- `classifyPassState()` (pass state classifier).

There is no way to distinguish "item genuinely completed" from "item archived
(skipped)" in any observable output.

### Desired Semantics

**Item-level status: `"archived"`**

Add `"archived"` to `PackageItemStatus` (the item status enum in
`src/lib/work-packages/orchestrate.ts`). When a linked task is archived,
reconcile the item to `"archived"` rather than `"done"`.

`"archived"` is a terminal item status:
- It does NOT trigger follow-up item creation.
- It counts as satisfied for dependency purposes (archived = item will not run).
- It is NOT counted as `"done"` in `rollupStatus()` for the clean-all check, but
  it IS counted as terminal (non-blocking).
- It IS excluded from `"failed"` propagation.

**Evidence `archivedCount`**

Pass evidence gains:

```typescript
archivedCount: number;          // items whose linked task is archived
archivedItems: Array<{ id: string; title: string }>;
```

**`classifyPassState()` update**

Archived items are NOT counted as `"held"`, `"failed"`, `"review"`, or
`"running"`. They are terminal and do not shift classification toward any
actionable state. The classifier input gains an `archivedCount` field used only
to populate evidence; it does not affect the classification result.

**`buildSummary()` update**

If `archivedCount > 0`:
`"3/5 items done; 1 archived; stopped: all_checks_clean"`

**Stop reason `"all_checks_clean"` fix**

Currently: stops when all item statuses are terminal.
After: stops when all non-archived items are terminal AND no failed gates.
Archived items are still terminal, so the condition holds — this is a
clarification, not a behavioral change. The summary must explicitly name
archived items so the operator knows work was skipped.

### Risks

- Adding `"archived"` to the item status enum is a schema migration. Items
  already in the DB with `status = "done"` that were archived tasks will remain
  `"done"` — no backfill needed (they are correct for their historical state).
- New item rows reconciled from archived tasks will receive `"archived"` going
  forward.
- UI must handle `"archived"` chip. String-grep test must cover this.

### Acceptance Criteria

- [ ] An item whose linked task is archived reconciles to `"archived"` status.
- [ ] `rollupStatus()` treats an all-archived-or-done Flight as `"done_with_skips"`.
- [ ] Pass evidence includes `archivedCount` and `archivedItems` list.
- [ ] `classifyPassState()` returns `"clean"` for a Flight with only archived/done items.
- [ ] `buildSummary()` includes archived count when > 0.
- [ ] The `"all_checks_clean"` stop reason fires correctly on an all-archived Flight.
- [ ] Console source renders `"archived"` item chip (string check in npm test).

---

## Enhancement 4: Post-Run Observability

### Current Evidence Structure

```typescript
{
  counts: Record<string, number>,
  state: PassStateClassification,
  failedItems: Array<{ id, title, blocker, taskOutput }>,
  reviewItems: Array<{ id, title, taskOutput }>,
  runningCount: number,
  blockedItemCount: number,
  git?: { status: string; diffStat: string },
  gates?: RepoGateResult[]
}
```

### Gaps

| Gap | Why It Matters |
|---|---|
| No `loopMode` in evidence | Can't tell if a pass was manual vs self_paced vs fixed from pass record alone |
| No `archivedCount` | Enhancement 3 above |
| No `gatesDiscovered` | Evidence records gate results but not which gates were found in package.json vs which were missing |
| No `passIndex` | The passNumber is on the pass record but not in evidence — LLM summaries lose context |
| No loop-level trend | Can't answer "did quality improve across passes?" without reading all pass records |

### Desired Additions

**Evidence object additions (all passes):**

```typescript
interface PassEvidence {
  // --- existing ---
  counts: Record<string, number>;
  state: PassStateClassification;
  failedItems: Array<{ id: string; title: string; blocker: string | null; taskOutput: string | null }>;
  reviewItems: Array<{ id: string; title: string; taskOutput: string | null }>;
  runningCount: number;
  blockedItemCount: number;
  git?: { status: string; diffStat: string };
  gates?: RepoGateResult[];
  // --- new ---
  archivedCount: number;          // items in archived state
  archivedItems: Array<{ id: string; title: string }>;
  gatesDiscovered: string[];      // gate names found in package.json (not necessarily run)
  passIndex: number;              // same as pass.passNumber, for embedded reference
  loopMode: LoopMode;             // mode at time of pass
}
```

**New loop summary endpoint:**

```
GET /work-packages/:id/loop/summary
```

Response:

```typescript
{
  loop: FlightLoop,
  recentPasses: Array<{
    passNumber: number;
    state: PassStateClassification;
    stopReason: string | null;
    createdItemCount: number;
    completedAt: string | null;
  }>,
  trend: "improving" | "stable" | "degrading" | "insufficient_data"
}
```

Trend computation (deterministic, no LLM):
- `improving`: last pass state < previous pass state in severity order
  (`risky > blocked > needs_follow_up > running > clean`).
- `degrading`: last pass state > previous.
- `stable`: same state across the last two completed passes.
- `insufficient_data`: fewer than two completed passes.

### Risks

- Adding fields to `evidence` is additive and backward-compatible (existing pass
  records just won't have the new keys; callers must handle missing keys).
- The summary endpoint is a new read-only route; no migration required.
- Trend logic must be deterministic and not call any model.

### Acceptance Criteria

- [ ] Pass evidence includes `archivedCount`, `gatesDiscovered`, `passIndex`, `loopMode`.
- [ ] `gatesDiscovered` lists gate names found in package.json even when gates
  are not run (e.g. because Flight has no items yet).
- [ ] `GET /work-packages/:id/loop/summary` returns loop + last 5 passes + trend.
- [ ] Trend is `"improving"` when last pass state is less severe than previous.
- [ ] Trend is `"degrading"` when last pass state is more severe.
- [ ] Trend is `"insufficient_data"` with one or zero completed passes.
- [ ] Evidence from old passes missing the new keys does not throw in the summary
  handler.

---

## Enhancement 5: Profile-Specific Pass Policies

### Current Behavior

All four profiles (`quality`, `release`, `watch`, `personal_admin`) execute
identical quality-profile logic. The `profile` field is stored but ignored in
`runPass()` in `src/lib/work-packages/flight-loop-pass.ts`.

### Desired Per-Profile Policies

#### Quality (existing — keep as-is)

- Reconcile → inspect → gate discovery → gate execution (if available) → follow-up items.
- Gates are optional: pass continues even if gates are missing or fail.
- Stop when: `all_checks_clean`, `max_passes_reached`, `no_actionable_follow_up`,
  `risky_action_held`, `waiting_for_approval`, `expired`, `flight_complete`.

#### Release

Goals: ensure code is shippable. Gates are mandatory, not optional.

Changes from quality:
- Gates are required. If any of `typecheck`, `tests`, or `scope-wall` are missing
  from `package.json`, the pass fails with `stopReason: "release_gate_missing"`.
  The loop stops (not just the pass).
- If any mandatory gate fails, the pass result is `PassStatus: "failed"` and the
  loop stops with `stopReason: "release_gate_failed"`.
- Follow-up items for deploy, publish, release, or any risky category are always
  created as `held`, regardless of `autoCreateItems` or `autoReadySafeItems`.
- Additionally checks for the presence of a `CHANGELOG.md` or `release-notes.md`
  at the project root. If absent, creates a held follow-up item to add one.
- `buildSummary()` for release passes includes gate pass/fail status explicitly.

#### Watch

Goals: observe external state, not mutate local state.

Changes from quality:
- No follow-up items are created, regardless of `autoCreateItems`. The loop only
  observes.
- No local gates are run (no typecheck, tests, or scope-wall).
- No git evidence is gathered.
- Evidence instead contains `externalChecks`: a stub array of external check
  results (CI, PR state, TestFlight — all stubbed as `"not_configured"` in MVP).
- Stop reasons:
  - `"external_state_unchanged"`: all checks unchanged from previous pass
    (schedule another check if loop mode is fixed/self_paced).
  - `"external_state_resolved"`: all tracked external checks report green.
  - Standard bounds still apply (`max_passes_reached`, `expired`).
- In MVP, all external checks are stubbed. The profile is scaffolded and
  observable so operators can see it doing nothing, which is correct behavior.

#### Personal Admin

Goals: non-destructive personal-workflow housekeeping.

Changes from quality:
- No risky, deploy, credentialed, or destructive follow-up items. Any follow-up
  items are created as `draft` regardless of risk.
- No git gates by default (can be enabled via custom command list in future).
- Additional check: query `GET /system/readiness` and include readiness results
  in evidence. If voice diagnostics fail, create a draft follow-up.
- Checks for pending approvals (Flight items in `held` status) and adds them to
  evidence as `pendingApprovals`.
- Stop reason `"all_admin_clear"`: no pending approvals, no failed items, no
  readiness failures.

### Risks

- Release profile's "stop loop on gate failure" is more aggressive than quality's
  "continue despite failures." This may surprise operators who expected the loop
  to keep trying. Mitigation: make this behavior explicit in the stop reason and
  UI copy.
- Watch profile's stub-only MVP must NOT give false confidence that external
  state is being monitored. Evidence must clearly say `"not_configured"` for each
  check, not `"clean"`.
- Personal Admin's readiness check calls a local endpoint; it must not throw if
  the endpoint is unavailable (best-effort, evidence key `readinessAvailable: false`).

### Acceptance Criteria

- [ ] Release pass fails with `stopReason: "release_gate_missing"` when typecheck
  is absent from package.json.
- [ ] Release pass stops the loop (not just the pass) when mandatory gates fail.
- [ ] Release pass creates deploy/publish items as `held` regardless of `autoReadySafeItems`.
- [ ] Watch pass creates zero follow-up items.
- [ ] Watch pass evidence contains `externalChecks` array.
- [ ] Watch pass stop reason is `"external_state_unchanged"` when no checks are configured.
- [ ] Personal Admin pass creates no `held` items; all items are `draft`.
- [ ] Personal Admin pass evidence contains `pendingApprovals` count.
- [ ] Profile-specific logic is isolated in a per-profile strategy function, not
  a long if/else chain in `runPass()`.

---

## Data Model Changes

### `PackageItemStatus` (orchestrate.ts)

Add `"archived"` to the item status union.

### `PackageStatus` (store.ts)

Add `"done_with_skips"` to the Flight status union.

```typescript
type PackageStatus =
  | "draft" | "held" | "ready" | "running" | "review"
  | "done" | "done_with_skips"       // <- new
  | "failed" | "cancelled";
```

### `PassStatus` (flight-loop-store.ts)

Add `"skipped"` to the pass status union.

```typescript
type PassStatus = "running" | "completed" | "failed" | "skipped";
```

### Evidence Type (flight-loop-pass.ts)

Add new fields listed in Enhancement 4.

### No DB migrations required beyond what already exists

The `PackageItemStatus`, `PackageStatus`, and `PassStatus` types are stored as
TEXT in SQLite. Adding new string values is backward-compatible.

---

## Testing Strategy

All production code changes must be preceded by failing tests.

### Unit tests (fast, no I/O)

- `classifyPassState` with archived items.
- `rollupStatus` for `done_with_skips` and archived edge cases.
- Profile-specific stop-reason logic (release gate missing/failed, watch
  external_state_unchanged, personal_admin all_admin_clear).
- Skipped pass does not increment passCount.
- Trend computation for improving/degrading/stable/insufficient_data.

### Integration tests (in-process SQLite)

- `readyWorkPackage()` auto-creates a self-paced quality loop.
- Idempotency: second `readyWorkPackage()` does not create a second loop.
- Skipped pass is written to DB when Flight is held.
- `done_with_skips` rollup fires when archived items exist.
- Archived item evidence appears in the pass record.
- Release loop stops when typecheck gate is missing.
- Watch pass creates no items.

### Server tests

- `GET /work-packages/:id/loop/summary` returns trend data.
- Trend is `"insufficient_data"` for a loop with one pass.

### Console source tests (string-grep via npm test)

- `"done_with_skips"` chip is handled.
- `"archived"` item status chip is handled.
- `"skipped"` pass status is handled.

---

## Implementation Order

Implement in dependency order; each step must pass gates before the next begins.

1. **Enhancement 3 core**: Add `"archived"` item status in orchestrate.ts +
   evidence tracking. (No schema migration; additive.)
2. **Enhancement 2**: Add `"done_with_skips"` PackageStatus in rollupStatus +
   `"skipped"` PassStatus in flight-loop-store.ts.
3. **Enhancement 4 evidence fields**: Add new keys to PassEvidence; update
   buildSummary and gathering.
4. **Enhancement 1**: Auto-create loop in readyWorkPackage.
5. **Enhancement 4 summary endpoint**: New GET route.
6. **Enhancement 5 profiles**: Release → Watch → Personal Admin strategies.

---

## Acceptance Criteria (Full Set)

All items from individual enhancements plus:

- [ ] `npm run typecheck` — zero errors.
- [ ] `npm test` — all tests passing, including new tests.
- [ ] `node scripts/scope-wall.mjs` — zero violations.
- [ ] No cloud LLM API calls introduced (keyless only).
- [ ] No credentials or tokens in any evidence, summary, or pass record.
- [ ] Existing Flight and loop behavior (Slice 1 + 2) unchanged for quality profile.
