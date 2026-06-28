# Flight Advance Review-to-Done Gap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-06-28-flight-advance-review-done-design.md`

TDD discipline is mandatory. Every task starts with a failing test.
Write the test, confirm it is RED, then write the minimum production code to
make it GREEN. Run `npm run typecheck && npm test` after every task.

**Do not combine tasks.** Each task is a complete RED→GREEN cycle with a gate.

---

## Phase 1 — AdvanceResult includes reviewItems

Adds structured info about blocking review items so the caller knows why
`started` is empty. Required before the server changes in Phases 2 and 3 so
the broadcast data is immediately useful.

### Task 1.1 — RED: AdvanceResult.reviewItems

File: `src/lib/work-packages/orchestrate.test.ts`

Add a test:

```
"advanceWorkPackage includes reviewItems for items blocking progress"
```

Setup:
- Create a work package with two items: item A (review, linked task in review
  state) and item B (ready, dependsOn [A]).
- Call `advanceWorkPackage(packageId)`.

Assertions:
- `result.started` is empty (`[]`).
- `result.reviewItems` is an array with one entry: `{ id: A.id, title: A.title, createdTaskId: A.createdTaskId, reviewState: "ready_for_review" }`.
- `result.package.status` is `"review"`.

Expected test result: **FAIL** — `AdvanceResult` has no `reviewItems` field.

- [ ] Test written and confirmed RED.

### Task 1.2 — GREEN: add reviewItems to AdvanceResult

File: `src/lib/work-packages/orchestrate.ts`

1. Extend `AdvanceResult`:
   ```typescript
   export interface AdvanceResult {
     started: string[];
     reviewItems: Array<{ id: string; title: string; createdTaskId: string | null; reviewState: string | null }>;
     package: WorkPackageDetail;
   }
   ```

2. In `advanceWorkPackage()`, after the `started` loop and before the rollup,
   compute `reviewItems` from the refreshed `detail.items`:
   ```typescript
   const reviewItems = detail.items
     .filter((i) => i.status === "review")
     .map((i) => ({ id: i.id, title: i.title, createdTaskId: i.createdTaskId ?? null, reviewState: (i as Record<string, unknown>).reviewState as string | null ?? null }));
   ```
   Return `{ started, reviewItems, package: detail }`.

Note: `WorkPackageItem` may not yet have a `reviewState` field — add it if
missing, sourced from the linked task's `reviewState` column via `getWorkPackage`.
If `reviewState` is not available on the item shape, default to `null`; do not
block the fix on schema changes.

- [ ] `npm run typecheck && npm test` — GREEN.

---

## Phase 2 — PATCH hook includes "archived"

The PATCH hook on `src/daemon/server.ts` must fire for `"archived"` status so
that any automated or direct PATCH to archived triggers reconciliation.

### Task 2.1 — RED: PATCH archived does not advance the package

File: `src/daemon/console.test.ts` (server integration tests)

Add a test:

```
"PATCH /tasks/:id with status archived triggers package reconcile"
```

Setup:
- Create a work package with one item in `review` linked to a task with
  `source: "work-package"`.
- Call `PATCH /tasks/:id` with body `{ status: "archived" }`.

Assertions:
- The work package item's status is `"archived"` after the request.
- Any `ready` dependent item that was unblocked by this transition is started
  (task created, broadcast fired).

Expected test result: **FAIL** — trigger list does not include `"archived"`.

- [ ] Test written and confirmed RED.

### Task 2.2 — GREEN: add "archived" to PATCH hook trigger list

File: `src/daemon/server.ts`, line ~3717.

Change:
```typescript
["done", "failed", "cancelled", "review"].includes(
```
To:
```typescript
["done", "failed", "cancelled", "review", "archived"].includes(
```

No other changes in this task.

- [ ] `npm run typecheck && npm test` — GREEN.

---

## Phase 3 — Archive action triggers package advance

`POST /tasks/:id/archive` must call `advanceWorkPackage` for work-package-sourced
tasks, matching the existing PATCH hook pattern exactly.

### Task 3.1 — RED: archive action does not advance the package

File: `src/daemon/console.test.ts`

Add a test:

```
"POST /tasks/:id/archive on a work-package-sourced review task reconciles the package"
```

Setup:
- Create a work package with item A (`review`, linked task in `review`,
  `source: "work-package"`) and item B (`ready`, `dependsOn: [A]`).
- Call `POST /tasks/A.createdTaskId/archive`.

Assertions:
- Response is 200.
- Item A status is `"archived"`.
- Item B has a created task (was started by the advance hook).
- `work-packages:updated` was broadcast.

Expected test result: **FAIL** — archive handler does not call `advanceWorkPackage`.

- [ ] Test written and confirmed RED.

### Task 3.2 — GREEN: add advance hook to archive action handler

File: `src/daemon/server.ts`, immediately after line 3873 (`Task.findByIdAndUpdate`
for archive), before `broadcast` and `json`:

```typescript
// archive
const t = await Task.findByIdAndUpdate(tid, { status: "archived" });
if (!t) { json(res, 404, { error: "Not found" }); return; }
broadcast("tasks:updated", { taskId: tid, status: "archived" });
// Work Package advance hook: same pattern as the PATCH hook above.
// POST /tasks/archive-completed (bulk) is explicitly NOT hooked here —
// review packages are covered by the 15-second tick (see Gap 3 fix).
if ((t as Record<string, unknown>).source === "work-package") {
  try {
    const { findItemByTaskId } = await import("@/lib/work-packages/store");
    const owner = findItemByTaskId(t._id);
    if (owner) {
      const { advanceWorkPackage } = await import("@/lib/work-packages/orchestrate");
      const r = await advanceWorkPackage(owner.packageId);
      for (const itemId of r.started) {
        const linked = r.package.items.find((i) => i.id === itemId);
        if (linked?.createdTaskId) broadcast("tasks:created", { taskId: linked.createdTaskId });
      }
      broadcast("work-packages:updated", { packageId: owner.packageId });
    }
  } catch (e) {
    console.error(`[work-packages] advance hook (archive) failed: ${e instanceof Error ? e.message : e}`);
  }
}
json(res, 200, t); return;
```

- [ ] `npm run typecheck && npm test` — GREEN.

---

## Phase 4 — Tick loop covers review packages

The 15-second backstop must also reconcile packages in `review` state, so that
archive actions taken outside the event hook (daemon restart, direct DB write,
bulk archive) are caught automatically.

### Task 4.1 — RED: tickWorkPackages skips review packages

File: `src/lib/work-packages/orchestrate.test.ts`

Add a test:

```
"tickWorkPackages advances a review package whose child task was archived"
```

Setup:
- Create a work package with item A (`review`, linked task now archived in DB)
  and item B (`ready`, `dependsOn: [A]`). Package status = `"review"`.
- Simulate that the archive happened without going through the event hook
  (set task.status = "archived" directly in DB).
- Call `tickWorkPackages()`.

Assertions:
- Item A status is `"archived"`.
- Item B has a created task (started).
- Package status rolled up to `"running"` (B is now running) or `"done"` if B
  was a no-op.

Expected test result: **FAIL** — `listWorkPackages({ status: "running" })` does
not return the `"review"` package.

- [ ] Test written and confirmed RED.

### Task 4.2 — GREEN: tick running and review packages

File: `src/lib/work-packages/orchestrate.ts`, `tickWorkPackages()`.

Change:
```typescript
const running = listWorkPackages({ status: "running" });
```
To:
```typescript
const running = listWorkPackages({ status: "running" });
const reviewing = listWorkPackages({ status: "review" });
const toTick = [...running, ...reviewing];
```
And replace `for (const pkg of running)` with `for (const pkg of toTick)`.

Verify `listWorkPackages` accepts a `status` filter (it does: existing usage at
line 182). If `listWorkPackages` does not deduplicate, check that a package
cannot be in both lists (it cannot — status is a single value).

- [ ] `npm run typecheck && npm test` — GREEN.

---

## Phase 5 — Regression and gate verification

### Task 5.1 — Regression: non-work-package task archive is safe

File: `src/daemon/console.test.ts`

Add a test:

```
"POST /tasks/:id/archive for a task with no owning work package item does not throw"
```

Setup:
- Create a plain task (no `source: "work-package"`, no work package item).
- Call `POST /tasks/:id/archive`.

Assertions:
- Response is 200.
- No error thrown.

- [ ] Test written and confirmed GREEN immediately (guard is already present in
  the archive handler: `findItemByTaskId` returns null and the `if (owner)` guard
  skips the advance). If it fails, add the null guard.

### Task 5.2 — Regression: tick does not advance terminal packages

File: `src/lib/work-packages/orchestrate.test.ts`

Add a test (or extend existing):

```
"tickWorkPackages does not advance packages in draft, held, done, failed, or cancelled states"
```

Setup:
- Create packages in each of: `draft`, `held`, `done`, `failed`, `cancelled`.
- Call `tickWorkPackages()`.

Assertions:
- `advanceWorkPackage` was NOT called for any of these packages (mock or spy on
  the advance function, or verify no tasks were created).

- [ ] Test written and confirmed GREEN.

### Task 5.3 — Final gates

Run all verification gates in sequence:

```sh
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

- [ ] `npm run typecheck` — zero errors.
- [ ] `npm test` — all tests passing.
- [ ] `node scripts/scope-wall.mjs` — zero violations.

---

## Summary of Production File Changes

| File | Change |
|---|---|
| `src/lib/work-packages/orchestrate.ts` | Extend `AdvanceResult` with `reviewItems`; compute reviewItems in `advanceWorkPackage`; extend `tickWorkPackages` to include `review` packages |
| `src/daemon/server.ts` | Add `"archived"` to PATCH hook trigger list; add advance hook to `POST /tasks/:id/archive` handler |

No schema migrations required. No new dependencies. No cloud LLM calls.

## Expected Test Delta

New tests: ~6 (tasks 1.1, 2.1, 3.1, 4.1, 5.1, 5.2)
Modified tests: 0 (existing tests must stay GREEN throughout)
