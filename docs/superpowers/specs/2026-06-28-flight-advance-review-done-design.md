# Flight Advance: Review-to-Done Gap

Date: 2026-06-28
Status: approved

## Dogfood Failure Scenario

A Flight had one child item in `review` status with a linked board task. Other
items in the package were `ready` and waiting on the review item as a dependency.
No agent was actively running.

**Sequence of events observed:**

1. Operator pressed **Advance** — nothing started; console showed no feedback.
2. Operator archived the linked board task via the board UI — board task became
   `archived`.
3. Flight item on the daemon remained `review` — the archive did not propagate.
4. The 15-second background tick did not rescue it either.
5. Operator had to directly patch the item to `done` to unblock the package.

Expected: archiving the linked task should have immediately reconciled the Flight
item, unblocked the dependent items, and started them.

---

## Root Cause: Three Missing Propagation Paths

### Gap 1 — `POST /tasks/:id/archive` does not advance the package

File: `src/daemon/server.ts`, around line 3872.

The archive action handler sets `task.status = "archived"` and broadcasts
`tasks:updated`, but never calls `advanceWorkPackage`. A Flight whose child is
in `review` will never receive a reconcile signal from this path.

### Gap 2 — `PATCH /tasks/:id` hook excludes `"archived"`

File: `src/daemon/server.ts`, line 3717.

The advance hook fires only when the updated task status is in:
`["done", "failed", "cancelled", "review"]`

`"archived"` is absent. Even if a task is set to archived via a PATCH call (e.g.
from an automated process or direct API call), the hook does not fire.

### Gap 3 — `tickWorkPackages` skips `review` packages

File: `src/lib/work-packages/orchestrate.ts`, line 182.

`tickWorkPackages` queries `listWorkPackages({ status: "running" })`. A Flight
whose rollup is `review` (all active items are in review) is never ticked by the
15-second backstop. There is no recovery path if the event hook was missed
(daemon restart, direct DB write, bulk archive).

---

## Desired Semantics

### Semantics 1 — Archive action triggers package advance

When `POST /tasks/:id/archive` is called for a task that is the linked task of a
work package item:

1. Archive the task (existing: `status = "archived"`).
2. Immediately call `advanceWorkPackage(packageId)` — same pattern as the PATCH hook.
3. Broadcast `work-packages:updated` so the UI refreshes.

This is idempotent: if the item was already `archived`, reconcile is a no-op.

### Semantics 2 — PATCH hook includes `"archived"`

Add `"archived"` to the trigger status list in the PATCH hook:

```typescript
["done", "failed", "cancelled", "review", "archived"].includes(...)
```

This closes the hole for automated workflows and direct API usage.

### Semantics 3 — Tick loop includes `review` packages

`tickWorkPackages` must query both `running` AND `review` packages. A Flight in
`review` status is waiting for operator action, but its child tasks may have
since been archived or resolved through paths the event hook missed. The
15-second tick is the backstop for exactly this class of race.

Cost: one extra indexed query and potentially a few no-op reconcile calls per
tick. Negligible.

### Semantics 4 — Advance response surfaces blocking review items

`AdvanceResult` already includes the full `package: WorkPackageDetail` which
contains every item and its status. No new fields are required in `AdvanceResult`
itself. However, the server's advance handler must ensure the broadcast and
response JSON includes enough for the UI to show a meaningful "blocked by review"
state rather than a silent empty `started` array.

The UI should display: for each item in `review`, the linked task ID, the review
state (`needs_input` vs `ready_for_review`), and a prompt to resolve or archive
the task. This is a UI/console concern, not an orchestration concern — the data
is already present in the package detail.

---

## Acceptance Criteria

### AC-1: Archive action triggers package reconcile

- [ ] `POST /tasks/:id/archive` on a work-package-sourced task in review state
  calls `advanceWorkPackage` for the owning package.
- [ ] After the archive action, the Flight item's status is `"archived"` (not
  still `"review"`).
- [ ] Dependent items that were `ready` and unblocked by the review item's
  resolution are started (tasks created) in the same request.
- [ ] The advance hook failure does NOT prevent the archive response from
  returning 200 (same guard as the PATCH hook).
- [ ] Archiving a task that has no owning work package item is a no-op for the
  advance hook — no error thrown.
- [ ] `POST /tasks/archive-completed` (bulk archive) is explicitly out of scope
  for per-package advance; the gap is acceptable for bulk cleanup. This must
  be documented in code with a comment.

### AC-2: PATCH hook includes archived status

- [ ] `PATCH /tasks/:id` with body `{ status: "archived" }` for a
  work-package-sourced task triggers `advanceWorkPackage`.
- [ ] The item reconciles to `"archived"` and dependents start.

### AC-3: Tick loop covers review packages

- [ ] `tickWorkPackages` advances both `running` and `review` packages.
- [ ] A Flight in `review` state whose child task was archived outside the
  event hook reconciles to `"archived"` on the next tick.
- [ ] Packages with other statuses (`draft`, `held`, `done`, `done_with_skips`,
  `failed`, `cancelled`) are NOT ticked (no change to existing behavior for
  those states).

### AC-4: Advance on an all-review Flight is not a silent no-op

- [ ] `AdvanceResult` (returned by the `/advance` endpoint) includes
  `reviewItems: Array<{ id, title, createdTaskId, reviewState }>` — items
  currently blocking progress.
- [ ] When `started` is empty but `reviewItems` is non-empty, the server
  returns the reviewItems so the caller can display an actionable message.
- [ ] When `started` is empty and `reviewItems` is also empty (package
  legitimately stuck), the response is unchanged (no regressions).

---

## Test Strategy

All tests must be written before production code changes (RED first).

### Unit tests — `orchestrate.test.ts`

- `tickWorkPackages advances a review package whose child was archived` —
  create package with one review item (task archived), call tickWorkPackages,
  assert item becomes "archived" and dependent "ready" item is started.
- `planNextItems treats archived item as done for dependency resolution` —
  already covered in existing test for `doneIds`; add explicit archived-item
  case to confirm.

### Integration tests — `orchestrate.test.ts` or new `server.test.ts` block

- `POST /tasks/:id/archive advances the owning package` — create package with
  review item, call archive action, assert item archived + dependent started
  in response.
- `PATCH /tasks/:id with status archived advances the owning package` — same
  assertion via PATCH.

### Unit tests — `orchestrate.ts` AdvanceResult type

- `advanceWorkPackage includes reviewItems in result` — call advance on a
  package with two items: one review, one ready (dependent on review). Assert
  `result.reviewItems` has the review item; `result.started` is empty.

### Regression tests

- `POST /tasks/:id/archive for a non-work-package task does not throw` —
  ensures the advance hook's findItemByTaskId returns null cleanly.
- `tickWorkPackages does not tick draft/held/done/failed packages` — assert
  only running and review packages are advanced.

---

## Out of Scope

- `POST /tasks/archive-completed` bulk advance: documented gap, not worth the
  complexity of per-package lookups in a bulk cleanup endpoint. If an operator
  bulk-archives, the subsequent 15-second tick (now covering review packages)
  will reconcile any affected packages automatically.
- UI changes to surface review item guidance: the data is already in the
  AdvanceResult package detail; a follow-up UI ticket can use it.
- `done_with_skips` Flight status: covered in
  `docs/superpowers/specs/2026-06-28-flight-loop-enhancements-design.md`.
