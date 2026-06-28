# Flight Item Retry Semantics — Design Spec

**Date:** 2026-06-28  
**Status:** Incident-driven — documenting observed failure + defining correct semantics  
**Observed failure:** Task `fd4a744992d748bea2a80655` retried from `failed`; Flight item `071937bb201a43598699c6e2` required manual status repair (`failed` → `running`) before the Goal Flight could continue.

---

## 1. Incident Summary

A task linked to Flight item `071937bb201a43598699c6e2` failed. An operator (or automated mechanism) retried the task — resetting it from `failed` back to an active status (`backlog` or `in_progress`). The Flight item **did not self-heal**; it remained `failed`. The Goal Flight therefore stayed `failed` (via `rollupStatus()`) and the loop did not progress. Manual intervention was required to set the item back to `running`.

---

## 2. Root Cause

### `reconcileWorkPackage()` skips `failed` items

`src/lib/work-packages/orchestrate.ts`, lines 87–107:

```typescript
for (const item of pkg.items) {
  if (item.status !== "running" && item.status !== "review") continue;
  // ...reconcile task → item status...
}
```

This guard was written under the assumption that `failed` is a **terminal state** for items. That holds when the task itself is terminal. It breaks when a task is **retried** (i.e., its status is reset to a non-terminal value externally), because:

1. The task's new status (`backlog`/`in_progress`) maps to `running` via `itemStatusForTask()`.
2. But the item's guard (`status !== "running" && status !== "review"`) skips it entirely.
3. Result: item stays `failed`; Flight stays `failed`; loop does nothing.

### `rollupStatus()` propagates the stale `failed`

`src/lib/work-packages/orchestrate.ts`, lines 110–126:

```typescript
if (statuses.has("failed")) return "failed";
```

Any `failed` item makes the whole Flight `failed`. There is no "failed but task was retried" distinction.

---

## 3. Current vs. Expected State Machine

### Task → Item mapping (existing, `itemStatusForTask()`)

| Task status          | Item status |
|----------------------|-------------|
| `done`               | `done`      |
| `archived`           | `archived`  |
| `failed`             | `failed`    |
| `cancelled`          | `cancelled` |
| `review`/`needs_input` | `review`  |
| `backlog`/`assigned`/`in_progress` | `running` |

The mapping is correct. The bug is that `reconcileWorkPackage()` never applies it to items already in `failed`.

### Expected item state machine (corrected)

```
draft → ready → running ─────────────────────────────────────┐
                   │                                          │
                   ▼                                         │
                failed ──► (task retried) ──► running ──► done
                   │
                   ▼ (if no retry)
              [follow-up item created by pass]
```

A `failed` item should NOT be a hard terminal state if its linked task is still live and has been reset. It should heal to `running` on the next reconcile cycle.

---

## 4. Expected Retry Semantics (Normative)

### 4a. Automatic self-heal (the fix)

When `reconcileWorkPackage()` runs, for every item in `failed` status that has a linked `taskId`:

1. Look up the task's current status.
2. Apply `itemStatusForTask()`.
3. If the result is **not** `failed` (i.e., the task was retried or reassigned), update the item status to the new value and clear `blocker`.
4. If the result is still `failed`, leave the item unchanged.

This makes retry self-healing without requiring any operator action beyond retrying the task.

### 4b. Follow-up item creation (existing behavior, unchanged)

The Flight Loop Pass's follow-up creation logic is correct and should remain:

- Failed item detected → new follow-up item created (`draft`/`ready`/`held` by risk).
- The original item stays `failed`.
- If the follow-up's task succeeds, both items end in terminal states and the Flight resolves.

Follow-up creation is the **proactive** path (loop proposes a new approach). Self-heal is the **reactive** path (operator directly retries the same task). Both must work.

### 4c. When a follow-up task is also retried

Same rule applies: if the follow-up item is `failed` and its task is reset, the follow-up item self-heals to `running` on the next reconcile.

### 4d. Task retry does NOT create a second follow-up

The Pass must not create a follow-up for an item whose task has already been retried (i.e., the task is no longer `failed`). Guard: skip follow-up creation for items whose linked task status ≠ `failed`.

Current code already handles this correctly — it checks `item.status === "failed"` but the self-heal fix means the item will no longer be `failed` by the time the Pass runs. No additional change needed in the pass.

---

## 5. Exact Code Changes Required

### 5a. `src/lib/work-packages/orchestrate.ts` — `reconcileWorkPackage()`

**Current guard (line ~87):**
```typescript
if (item.status !== "running" && item.status !== "review") continue;
```

**Corrected guard:**
```typescript
const isReconcilable =
  item.status === "running" ||
  item.status === "review" ||
  (item.status === "failed" && item.taskId != null);
if (!isReconcilable) continue;
```

**After computing `newStatus` from `itemStatusForTask()`:**
```typescript
if (newStatus === item.status) continue; // no change

// Transitioning a failed item back to active: clear the blocker
const patch: Partial<FlightItem> = { status: newStatus };
if (item.status === "failed" && newStatus !== "failed") {
  patch.blocker = undefined;
}
await updateItem(pkg.id, item.id, patch);
```

### 5b. No changes required in `flight-loop-pass.ts` or `follow-up-creator.ts`

The pass only processes items where `item.status === "failed"`. After the self-heal fix, a retried item will be `running` by the time the pass sees it, so no follow-up will be created. Correct behavior.

---

## 6. Verification

### Test cases to add in `orchestrate.test.ts`

| Scenario | Setup | Expected |
|----------|-------|----------|
| Task retried after item failure | Item `failed`, linked task reset to `in_progress` | Item transitions to `running`, `blocker` cleared |
| Task still failed | Item `failed`, linked task still `failed` | Item stays `failed`, `blocker` unchanged |
| No linked task | Item `failed`, no `taskId` | Item stays `failed` (no reconcile) |
| Follow-up retried | Follow-up item `failed`, its task reset to `backlog` | Follow-up item transitions to `running` |
| Flight status after self-heal | One item was `failed` (task retried → now `in_progress`) | `rollupStatus()` returns `running`, not `failed` |

---

## 7. Operational Runbook (Until Fix Ships)

If a Flight item is stuck `failed` but its task was retried:

1. Open the Work Packages console.
2. Find the stuck item (`071937bb201a43598699c6e2` pattern: `status: failed`, task in active state).
3. Manually patch item status to `running` and clear `blocker`.
4. The Flight Loop will pick it up on the next heartbeat (≤15 s).

This is the manual step that should become unnecessary after the fix in §5a.

---

## 8. Out of Scope

- Automatic retry limits (max retries per item) — follow-up creation already handles retry-depth via `maxPasses`.
- Retry backoff — tasks are retried externally (operator or board automation); the item just follows the task.
- Resurrection of items with no linked task — not meaningful; those items were never running a task.
