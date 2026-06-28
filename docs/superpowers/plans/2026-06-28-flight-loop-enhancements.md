# Flight Loop Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-06-28-flight-loop-enhancements-design.md`
Extends: `docs/superpowers/specs/2026-06-27-flight-loops-quality-passes-design.md`

TDD discipline is mandatory. Every task starts with a failing test. Do NOT write
production code until the test is confirmed RED. Only then write the minimum code
to make it GREEN. Run `npm run typecheck && npm test` after each task.

---

## Phase 1 — Archived Item Transition Coverage (Enhancement 3)

### Task 1.1 — RED: archived item reconciles to "archived" status

File: `src/lib/work-packages/orchestrate.test.ts`

Add a test that:
1. Creates a Flight with one item linked to a task.
2. Sets the linked task status to `"archived"`.
3. Calls `reconcileWorkPackage()`.
4. Asserts the item's `status` field equals `"archived"` (not `"done"`).

Expected test result: FAIL (the switch case returns `"done"` for archived tasks).

### Task 1.2 — GREEN: add "archived" item status to reconcile switch

File: `src/lib/work-packages/orchestrate.ts`

- Add `"archived"` to the `PackageItemStatus` type (wherever the type is defined
  — likely the same file or `store.ts`).
- In the `reconcileItemFromTask()` switch, change `case "archived": return "done"`
  to `case "archived": return "archived"`.
- In `rollupStatus()`, treat `"archived"` as terminal (same as `"done"` for
  blocking purposes, but do not count as `"done"` for the done-check).

Verify Task 1.1 is GREEN. Run `npm run typecheck && npm test`.

### Task 1.3 — RED: rollupStatus returns done_with_skips

File: `src/lib/work-packages/orchestrate.test.ts`

Add tests:
- `"rollupStatus returns done_with_skips when all items done or archived and at least one archived"`:
  items `[done, archived]` → `"done_with_skips"`.
- `"rollupStatus returns done when all items done, none archived"`:
  items `[done, done]` → `"done"`.
- `"rollupStatus returns failed when any item failed even with archived items"`:
  items `[done, archived, failed]` → `"failed"`.

Expected test result: FAIL (`"done_with_skips"` is not in PackageStatus).

### Task 1.4 — GREEN: add done_with_skips to PackageStatus and rollupStatus

File: `src/lib/work-packages/store.ts`

- Add `"done_with_skips"` to `PackageStatus` type.

File: `src/lib/work-packages/orchestrate.ts`

- In `rollupStatus()`: after computing the normal rollup, if result would be
  `"done"` and `archivedCount > 0`, return `"done_with_skips"` instead.

Console source: grep for exhaustive PackageStatus switches and add
`"done_with_skips"` handling. At minimum add the string so npm test can grep it.

File: `src/lib/work-packages/flight-loop-scheduler.ts`

- Add `"done_with_skips"` to the terminal-state check:
  `["done", "done_with_skips", "failed", "cancelled"]`.

Verify Task 1.3 is GREEN. Run `npm run typecheck && npm test`.

### Task 1.5 — RED: pass evidence includes archivedCount and archivedItems

File: `src/lib/work-packages/flight-loop-pass.test.ts`

Add a test:
- Creates a Flight with two items: one done, one archived.
- Runs a pass.
- Asserts `pass.evidence.archivedCount === 1`.
- Asserts `pass.evidence.archivedItems` has one entry with `id` and `title`.
- Asserts `pass.evidence.counts["archived"] === 1`.

Expected test result: FAIL (evidence has no `archivedCount` key).

### Task 1.6 — GREEN: add archived tracking to pass evidence

File: `src/lib/work-packages/flight-loop-pass.ts`

In `runPass()` evidence-gathering block:
- When counting item statuses, include `"archived"` in the counts histogram.
- Collect `archivedItems: items.filter(i => i.status === "archived").map(i => ({ id: i.id, title: i.title }))`.
- Add `archivedCount: archivedItems.length` to evidence.

In `classifyPassState()`:
- Accept an `archivedCount` field in `ClassifyPassStateInput` (optional, defaults
  to 0). No behavior change — archived items do not affect classification.

In `buildSummary()`:
- If `archivedCount > 0`, append `"${archivedCount} archived"` to the summary
  parts alongside the done count.

Verify Task 1.5 is GREEN. Run `npm run typecheck && npm test`.

---

## Phase 2 — Skipped Pass Status (Enhancement 2)

### Task 2.1 — RED: skipped pass for held Flight

File: `src/lib/work-packages/flight-loop-pass.test.ts`

Add a test:
- Creates a Flight in `"held"` status.
- Creates a self-paced loop on the Flight.
- Calls `runPass(packageId)` directly.
- Asserts the returned pass has `status: "skipped"`.
- Asserts `pass.stopReason === "skipped_flight_not_ready"`.
- Asserts the loop's `passCount` did NOT increment.

Expected test result: FAIL (PassStatus has no `"skipped"` value; the function throws or proceeds).

### Task 2.2 — GREEN: add skipped PassStatus and early-exit in runPass

File: `src/lib/work-packages/flight-loop-store.ts`

- Add `"skipped"` to `PassStatus` type.

File: `src/lib/work-packages/flight-loop-pass.ts`

In `runPass()`, before acquiring the lock:
- Load the Flight via `getWorkPackage(packageId)`.
- If Flight status is `"draft"`, `"held"`, or `"review"`:
  - Write a pass record with `status: "skipped"`, `stopReason: "skipped_flight_not_ready"`.
  - Do NOT increment loop `passCount`.
  - Return early with the skipped pass.
- If the lock cannot be acquired (already running):
  - Write a pass record with `status: "skipped"`, `stopReason: "skipped_lock_held"`.
  - Do NOT increment `passCount`.
  - Return early.

Note: `"review"` Flight status means the operator is reviewing; passes should not
fire autonomously in that state. Manual passes (operator-triggered) bypass this
gate.

Verify Task 2.1 is GREEN. Run `npm run typecheck && npm test`.

### Task 2.3 — RED: skipped pass does not count toward maxPasses

File: `src/lib/work-packages/flight-loop-pass.test.ts`

Add a test:
- Creates a loop with `maxPasses: 1`.
- Forces a skipped pass (held Flight).
- Transitions Flight to `running`.
- Runs another pass.
- Asserts the second pass is NOT blocked by max-passes (passCount is still 0
  after the skip).

Expected test result: FAIL until Task 2.2 is complete; verify once GREEN.

### Task 2.4 — RED: scheduler skips held-Flight loops silently, records skipped pass

File: `src/lib/work-packages/flight-loop-scheduler.test.ts`

Add a test:
- Creates a self-paced loop with `nextRunAt = now` on a `held` Flight.
- Calls `tickFlightLoops()`.
- Asserts a skipped pass record was written to the DB.
- Asserts loop `passCount` is 0.
- Asserts loop status remains `"idle"` (not `"stopped"`).

Expected test result: FAIL (scheduler currently calls `runPass` which throws or silently skips; no skipped record).

After GREEN (from Task 2.2 changes): verify this test passes from Task 2.2.
If not, adjust scheduler to handle the skipped pass return value appropriately.

---

## Phase 3 — Post-Run Observability (Enhancement 4)

### Task 3.1 — RED: evidence includes loopMode, gatesDiscovered, passIndex

File: `src/lib/work-packages/flight-loop-pass.test.ts`

Add a test:
- Creates a Flight with a self-paced quality loop.
- Runs a pass.
- Asserts `pass.evidence.loopMode === "self_paced"`.
- Asserts `pass.evidence.passIndex === 1` (first pass).
- Asserts `pass.evidence.gatesDiscovered` is an array (may be empty if no
  package.json in test environment).

Expected test result: FAIL (no such keys in evidence).

### Task 3.2 — GREEN: add loopMode, passIndex, gatesDiscovered to evidence

File: `src/lib/work-packages/flight-loop-pass.ts`

In `runPass()`:
- Fetch the loop object at the start of evidence gathering.
- Add `loopMode: loop.mode` to evidence.
- Add `passIndex: pass.passNumber` to evidence.
- In the gate-discovery step (`discoverRepoGates()` or equivalent): regardless of
  whether gates are executed, record `gatesDiscovered: discoveredGateNames` in
  evidence. Currently the function returns `RepoGateResult[]` only when run;
  split discovery from execution so discovered names are always available.

Verify Task 3.1 is GREEN. Run `npm run typecheck && npm test`.

### Task 3.3 — RED: loop summary endpoint returns trend

File: `src/daemon/server.test.ts` (or equivalent integration test file)

Add a test:
- Creates a Flight with a quality loop.
- Runs two passes: first with state `"needs_follow_up"`, second with state `"clean"`.
- Calls `GET /work-packages/:id/loop/summary`.
- Asserts response has `loop`, `recentPasses` (array of 2), `trend: "improving"`.

Add another test:
- One pass only → `trend: "insufficient_data"`.

Expected test result: FAIL (route does not exist).

### Task 3.4 — GREEN: add GET loop/summary endpoint

File: `src/daemon/server.ts`

Add route `GET /work-packages/:id/loop/summary`:
- Load loop via `getLoop(packageId)` (by packageId, not loopId).
- Load last 5 passes via `getLoopPasses(loop.id, 5)`.
- Map passes to `{ passNumber, state, stopReason, createdItemCount, completedAt }`.
  - `state` comes from `pass.evidence.state` (may be undefined on old passes →
    default to `null`).
  - `createdItemCount` = `pass.createdItemIds.length`.
- Compute trend:
  - Severity order: `risky=4, blocked=3, needs_follow_up=2, running=1, clean=0`.
  - Take the last two completed (non-skipped) passes.
  - If fewer than two: `"insufficient_data"`.
  - If last < previous severity: `"improving"`.
  - If last > previous severity: `"degrading"`.
  - If equal: `"stable"`.
- Return `{ loop, recentPasses, trend }`.

File: `src/lib/work-packages/flight-loop-store.ts`

Add `getLoopByPackageId(packageId: string): FlightLoop | null` helper (currently
`getLoop()` takes a loopId, not packageId).

Verify Task 3.3 is GREEN. Run `npm run typecheck && npm test`.

---

## Phase 4 — Default Self-Paced Quality Loop (Enhancement 1)

### Task 4.1 — RED: readyWorkPackage auto-creates a self_paced quality loop

File: `src/lib/work-packages/store.test.ts`

Add a test:
- Creates a Flight in `"draft"` status with no loop.
- Calls `readyWorkPackage(id)`.
- Queries `getLoopByPackageId(id)`.
- Asserts loop exists with `mode: "self_paced"`, `profile: "quality"`,
  `maxPasses: 3`, `status: "idle"`, `nextRunAt: null`.

Add idempotency test:
- Creates a Flight with a pre-existing loop (`mode: "manual"`).
- Calls `readyWorkPackage(id)`.
- Asserts the loop is unchanged (`mode` is still `"manual"`).

Expected test result: FAIL (no loop is created by `readyWorkPackage()`).

### Task 4.2 — GREEN: auto-create loop in readyWorkPackage

File: `src/lib/work-packages/store.ts`

In `readyWorkPackage(id)`:
- After transitioning status to `"ready"`, call `getLoopByPackageId(id)`.
- If no loop exists, call `upsertLoop()` (or `createLoop()`) with defaults:
  ```typescript
  {
    packageId: id,
    mode: "self_paced",
    profile: "quality",
    maxPasses: 3,
    autoCreateItems: true,
    autoReadySafeItems: false,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    status: "idle",
    nextRunAt: null,
  }
  ```
- If a loop already exists, do nothing.

Verify Task 4.1 is GREEN. Run `npm run typecheck && npm test`.

### Task 4.3 — RED: held Flight does not receive auto-loop

File: `src/lib/work-packages/store.test.ts`

Add a test:
- Creates a Flight that bypasses `readyWorkPackage()` (e.g., inserted directly
  with status `"held"`).
- Asserts no loop exists for it.

Expected test result: PASS immediately (held Flights don't call `readyWorkPackage`).
Document this as a confirmed behavior guard, not a gap.

---

## Phase 5 — Profile-Specific Pass Policies (Enhancement 5)

### Task 5.1 — RED: release profile fails pass when mandatory gate missing

File: `src/lib/work-packages/flight-loop-pass.test.ts`

Add a test:
- Creates a Flight with a loop using `profile: "release"`.
- The test project has no `package.json` with a `typecheck` script (or mock
  gate discovery to return empty).
- Runs a pass.
- Asserts `pass.status === "failed"`.
- Asserts `pass.stopReason === "release_gate_missing"`.
- Asserts the loop status is `"stopped"` after the pass.

Expected test result: FAIL (release profile runs quality logic, does not fail on missing gates).

### Task 5.2 — GREEN: extract profile strategy + implement release gate enforcement

File: `src/lib/work-packages/flight-loop-pass.ts`

Refactor:
- Extract a `ProfileStrategy` interface:
  ```typescript
  interface ProfileStrategy {
    requiresGates: boolean;             // release=true, others=false
    allowsItemCreation: boolean;        // watch=false, others=true
    forceDraftItems: boolean;           // personal_admin=true, others=false
    forceHeldRiskyItems: boolean;       // release=true, others=per-policy
    stopLoopOnGateFailure: boolean;     // release=true, others=false
  }
  ```
- Implement a `getProfileStrategy(profile: PassProfile): ProfileStrategy` function.
- In `runPass()`, after gate discovery: if `strategy.requiresGates && gatesDiscovered.length === 0`, write a failed pass with `stopReason: "release_gate_missing"`, stop the loop, and return early.
- If mandatory gates are discovered but any fail and `strategy.stopLoopOnGateFailure`, write a failed pass and stop the loop.

Verify Task 5.1 is GREEN. Run `npm run typecheck && npm test`.

### Task 5.3 — RED: release profile forces deploy items to held

File: `src/lib/work-packages/flight-loop-pass.test.ts`

Add a test:
- Creates a Flight with a release loop and `autoReadySafeItems: true`.
- Mocks a follow-up item with `risk: "deploy"` being proposed.
- Runs a pass.
- Asserts the created item has `status: "held"` regardless of `autoReadySafeItems`.

Expected test result: FAIL (quality logic creates items based on autoReadySafeItems only).

### Task 5.4 — GREEN: apply forceHeldRiskyItems for release profile

File: `src/lib/work-packages/follow-up-creator.ts`

- Add a `forceHeld: boolean` parameter to `createFollowUpItems()`.
- When `forceHeld=true`, override item status to `"held"` for any item with
  risk category `"deploy"`, `"publish"`, `"release"`, `"credentialed"`, or `"destructive"`.

File: `src/lib/work-packages/flight-loop-pass.ts`

- Pass `forceHeld: strategy.forceHeldRiskyItems` to `createFollowUpItems()`.

Verify Task 5.3 is GREEN. Run `npm run typecheck && npm test`.

### Task 5.5 — RED: watch profile creates no follow-up items

File: `src/lib/work-packages/flight-loop-pass.test.ts`

Add a test:
- Creates a Flight with items in failed/review state and a loop using `profile: "watch"`.
- `autoCreateItems` is `true`.
- Runs a pass.
- Asserts `pass.createdItemIds.length === 0`.
- Asserts `pass.evidence.externalChecks` is an array.
- Asserts `pass.stopReason === "external_state_unchanged"`.

Expected test result: FAIL (watch profile runs quality logic and creates items).

### Task 5.6 — GREEN: implement watch profile strategy

File: `src/lib/work-packages/flight-loop-pass.ts`

In `runPass()`, when `strategy.allowsItemCreation === false`:
- Skip all follow-up item creation.
- Skip all local gate execution.
- Skip git evidence gathering.
- Add `externalChecks: []` to evidence (stub — all `"not_configured"` in MVP).
- Set `stopReason: "external_state_unchanged"` (no external checks configured).

Verify Task 5.5 is GREEN. Run `npm run typecheck && npm test`.

### Task 5.7 — RED: personal_admin profile never creates held items

File: `src/lib/work-packages/flight-loop-pass.test.ts`

Add a test:
- Creates a Flight with a `personal_admin` loop.
- Mocks a risky follow-up item being proposed (risk: `"destructive"`).
- Runs a pass.
- Asserts the created item has `status: "draft"` (not `"held"`).
- Asserts `pass.evidence.pendingApprovals` exists and is a number.

Expected test result: FAIL (personal_admin creates items with normal risk policy).

### Task 5.8 — GREEN: implement personal_admin profile strategy

File: `src/lib/work-packages/flight-loop-pass.ts`

When `strategy.forceDraftItems === true`:
- All created items get `status: "draft"` regardless of risk.

In evidence gathering for personal_admin:
- Add `pendingApprovals: items.filter(i => i.status === "held").length` to evidence.
- Attempt to call `GET /system/readiness` (internal fetch). If unavailable or
  throws, set `readinessAvailable: false` in evidence. If available, include
  key readiness results (scrubbed).
- Stop reason `"all_admin_clear"` when: `pendingApprovals === 0` AND no failed
  items AND (readinessAvailable === false OR readiness checks pass).

Verify Task 5.7 is GREEN. Run `npm run typecheck && npm test`.

---

## Phase 6 — Console Source Coverage (string-grep tests)

### Task 6.1 — RED: console handles done_with_skips, archived, skipped

These tests use npm test's string-grep approach (no rendering required).

Check which file handles PackageStatus chips or labels in the console source.
Add the following string assertions:

- `"done_with_skips"` appears in the status chip/label handler.
- `"archived"` appears in the item status chip/label handler.
- `"skipped"` appears in the pass status handler.

Expected test result: FAIL (strings not yet in console source).

### Task 6.2 — GREEN: add string handling to console source

Find the relevant console source files (likely under `src/` in the Tauri or
console package) and add minimal handling:

- `"done_with_skips"` → render as a "done" variant chip with a skip indicator.
- `"archived"` item status → render as a dimmed chip.
- `"skipped"` pass status → render as a gray chip.

Run `npm test` to confirm the string-grep tests pass.

---

## Verification Gates

Run these in order after all tasks are complete:

```bash
npm run typecheck   # zero errors
npm test            # all tests passing, including new tests
node scripts/scope-wall.mjs  # zero violations
```

Do NOT declare work complete until all three pass cleanly.

---

## Task Checklist Summary

### Phase 1 — Archived Item Coverage
- [ ] 1.1 RED: archived item reconciles to "archived" status
- [ ] 1.2 GREEN: add "archived" to reconcile switch
- [ ] 1.3 RED: rollupStatus returns done_with_skips
- [ ] 1.4 GREEN: add done_with_skips to PackageStatus and rollupStatus
- [ ] 1.5 RED: pass evidence includes archivedCount and archivedItems
- [ ] 1.6 GREEN: add archived tracking to pass evidence

### Phase 2 — Skipped Pass Status
- [ ] 2.1 RED: skipped pass for held Flight
- [ ] 2.2 GREEN: add skipped PassStatus and early-exit in runPass
- [ ] 2.3 RED/GREEN: skipped pass does not count toward maxPasses
- [ ] 2.4 RED/GREEN: scheduler records skipped pass for held-Flight loops

### Phase 3 — Post-Run Observability
- [ ] 3.1 RED: evidence includes loopMode, gatesDiscovered, passIndex
- [ ] 3.2 GREEN: add loopMode, passIndex, gatesDiscovered to evidence
- [ ] 3.3 RED: loop summary endpoint returns trend
- [ ] 3.4 GREEN: add GET loop/summary endpoint

### Phase 4 — Default Self-Paced Quality Loop
- [ ] 4.1 RED: readyWorkPackage auto-creates a self_paced quality loop
- [ ] 4.2 GREEN: auto-create loop in readyWorkPackage
- [ ] 4.3 RED/GREEN: held Flight does not receive auto-loop (guard)

### Phase 5 — Profile-Specific Pass Policies
- [ ] 5.1 RED: release profile fails pass when mandatory gate missing
- [ ] 5.2 GREEN: extract ProfileStrategy + implement release gate enforcement
- [ ] 5.3 RED: release profile forces deploy items to held
- [ ] 5.4 GREEN: apply forceHeldRiskyItems for release profile
- [ ] 5.5 RED: watch profile creates no follow-up items
- [ ] 5.6 GREEN: implement watch profile strategy
- [ ] 5.7 RED: personal_admin profile never creates held items
- [ ] 5.8 GREEN: implement personal_admin profile strategy

### Phase 6 — Console Source Coverage
- [ ] 6.1 RED: console handles done_with_skips, archived, skipped strings
- [ ] 6.2 GREEN: add string handling to console source

### Verification
- [ ] npm run typecheck — zero errors
- [ ] npm test — all tests passing
- [ ] node scripts/scope-wall.mjs — zero violations
