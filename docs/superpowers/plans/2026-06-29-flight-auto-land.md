# Flight Auto-Land Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Design doc:** `docs/superpowers/specs/2026-06-29-flight-auto-land-design.md`  
**Date:** 2026-06-29

---

## Context & Scope

The current `reconcileWorkPackage` (orchestrate.ts:136) maps every task `review` and `needs_input` status to the same item `review` state, then leaves all items for manual `Accept / Land`. The goal is to auto-land low-risk, clean items inside `reconcileWorkPackage` before they ever surface to the client, and to annotate manual-review items with a reason in the console UI.

Key files:
- `src/lib/work-packages/orchestrate.ts` — predicate + reconcile hook
- `src/lib/work-packages/flight-decision-label.ts` — review-reason utility
- `src/lib/work-packages/orchestrate.test.ts` — unit + integration tests
- `src/lib/work-packages/flight-decision-label.test.ts` — label unit tests
- `src/daemon/console.ts` — UI changes (flightItemActions at line 1766)
- `src/daemon/console.test.ts` — console rendering tests

---

## Tasks

### Task 1 — Unit tests: `shouldAutoLand` (RED)

**File:** `src/lib/work-packages/orchestrate.test.ts`

Add a `describe("shouldAutoLand")` block covering every branch of the predicate. These must fail (function does not exist yet).

Test matrix (7 cases):

| # | risk | taskStatus | blocker | executionMode | loop.profile | expected autoLand |
|---|------|-----------|---------|---------------|-------------|------------------|
| 1 | low | review | null | sequential | null | **true** |
| 2 | medium | review | null | sequential | null | false — "risk is medium" |
| 3 | high | review | null | sequential | null | false — "risk is high" |
| 4 | low | needs_input | null | sequential | null | false — "agent is waiting for input" |
| 5 | low | review | "some blocker" | sequential | null | false — "open blocker" |
| 6 | low | review | null | hold | null | false — "final-gated (hold)" |
| 7 | low | review | null | sequential | release | false — "release loop" |
| 8 | low | review | null | sequential | quality | **true** — quality loop doesn't gate |

Import the (not-yet-existing) `shouldAutoLand` from `../lib/work-packages/orchestrate`.  
Run `npm test -- orchestrate` — expect 8 failures on the new describe block.

---

### Task 2 — Unit tests: `computeReviewReason` (RED)

**File:** `src/lib/work-packages/flight-decision-label.test.ts`

Add a `describe("computeReviewReason")` block.

Test matrix (5 cases):

| # | taskStatus | risk | blocker | loop.profile | expected return |
|---|-----------|------|---------|-------------|----------------|
| 1 | needs_input | low | null | null | "Agent is waiting for your input" |
| 2 | review | medium | null | null | "Medium-risk change — operator sign-off required" |
| 3 | review | high | null | null | "High-risk change — operator sign-off required" |
| 4 | review | low | null | release | "Release sign-off required" |
| 5 | review | low | "NEEDS_OPERATOR_DECISION:{…}" | null | null (blocker HTML handles it) |
| 6 | review | low | null | null | null (clean auto-land case — no reason needed) |

Import `computeReviewReason` from `../lib/work-packages/flight-decision-label`.  
Run `npm test -- flight-decision-label` — expect failures on new cases.

---

### Task 3 — Integration tests: `reconcileWorkPackage` auto-land (RED)

**File:** `src/lib/work-packages/orchestrate.test.ts`

Add a `describe("reconcileWorkPackage — auto-land")` block. Uses the in-memory SQLite test DB already set up in the file.

Test matrix (5 cases):

| # | item.risk | task.status → | item.blocker | loop.profile | expected item.status after reconcile |
|---|-----------|-------------|-------------|-------------|--------------------------------------|
| 1 | low | review | null | null | **done** (auto-landed) |
| 2 | low | needs_input | null | null | review (manual) |
| 3 | medium | review | null | null | review (manual) |
| 4 | low | review | "error text" | null | review (manual — has blocker) |
| 5 | low | review | null | release | review (manual — release loop) |

For test 1, also assert:
- the linked task's status is `"archived"` after reconcile
- `getWorkPackage(id).items[0].status === "done"`

Helper pattern: create a package + running item, create a task, set the task status, call `reconcileWorkPackage(id)`, read back the item.

Run `npm test -- orchestrate` — expect new describe failures.

---

### Task 4 — Integration tests: `acceptWorkPackageItem` manual path (RED guard)

**File:** `src/lib/work-packages/orchestrate.test.ts`

Confirm the manual accept path still works when auto-land would NOT fire:

| # | Scenario | Expected |
|---|---------|---------|
| 1 | medium-risk item stays in review → operator calls `acceptWorkPackageItem` | item lands as done |
| 2 | auto-landed item (low-risk) unblocks a dependent ready item after reconcile | dependent item advances to running |

These may already pass if the manual path is untouched, but writing them now as regression guards.

---

### Task 5 — Implement `shouldAutoLand` in orchestrate.ts (GREEN)

**File:** `src/lib/work-packages/orchestrate.ts`

Add after the existing imports and before `itemStatusForTask`:

```typescript
export interface AutoLandDecision {
  autoLand: boolean;
  reason: string;
}

export function shouldAutoLand(
  item: Pick<WorkPackageItem, "risk" | "blocker" | "executionMode">,
  actualTaskStatus: string | null,
  loop: FlightLoop | null,
): AutoLandDecision {
  if (item.risk !== "low")
    return { autoLand: false, reason: `risk is ${item.risk}` };
  if (actualTaskStatus !== "review")
    return { autoLand: false, reason: actualTaskStatus === "needs_input" ? "agent is waiting for input" : `task status is ${actualTaskStatus}` };
  if (item.blocker !== null)
    return { autoLand: false, reason: "item has an open blocker" };
  if (item.executionMode === "hold")
    return { autoLand: false, reason: "item is final-gated (hold)" };
  if (loop && loop.profile === "release")
    return { autoLand: false, reason: "release loop requires sign-off" };
  return { autoLand: true, reason: "low-risk, clean completion, no open questions" };
}
```

`FlightLoop` is already imported at line 26 from `./flight-loop-store`. `WorkPackageItem` type is available in this file — confirm the exact import and use `Pick<>` to avoid tight coupling.

Run `npm test -- orchestrate` shouldAutoLand describe — expect 8/8 pass.

---

### Task 6 — Hook `shouldAutoLand` into `reconcileWorkPackage` (GREEN)

**File:** `src/lib/work-packages/orchestrate.ts`, inside `reconcileWorkPackage` (line 136–188)

In the loop body, after `newBlocker` is computed and before the `db.prepare(UPDATE…)` call, intercept the `next === "review"` case:

```typescript
// Intercept review to auto-land eligible low-risk items.
let effectiveNext = next;
if (next === "review") {
  const actualTaskStatus = String((task as Record<string, unknown>).status);
  const loop = getLoop(id);  // already imported at line 26
  const { autoLand } = shouldAutoLand(item, actualTaskStatus, loop);
  if (autoLand) {
    effectiveNext = "done";
    await Task.findByIdAndUpdate(item.createdTaskId, { status: "archived" });
    newBlocker = null;
    console.info(`[work-packages] auto-landed item ${item.id}: low-risk clean completion`);
  }
}
```

Then replace `next` with `effectiveNext` in the `db.prepare(UPDATE…)` call and in the `selfPacedTrigger` check. Be careful not to break the `next === item.status` short-circuit above (keep it checking `next`, not `effectiveNext` — it reads from the item's current status which doesn't yet reflect auto-land).

Also update the `selfPacedTrigger` line to use `effectiveNext`:
```typescript
if (["done", "archived", "failed", "review"].includes(effectiveNext)) selfPacedTrigger = true;
```

Run `npm test -- orchestrate` — all reconcile integration tests pass.

---

### Task 7 — Implement `computeReviewReason` in flight-decision-label.ts (GREEN)

**File:** `src/lib/work-packages/flight-decision-label.ts`

Append after existing exports:

```typescript
import type { FlightLoop } from "./flight-loop-store";

export function computeReviewReason(
  item: { taskStatus?: string | null; risk?: string | null; blocker?: string | null; executionMode?: string | null },
  loop: FlightLoop | null,
): string | null {
  if (item.taskStatus === "needs_input") return "Agent is waiting for your input";
  if (item.risk === "medium" || item.risk === "high")
    return `${item.risk.charAt(0).toUpperCase() + item.risk.slice(1)}-risk change — operator sign-off required`;
  if (loop && loop.profile === "release") return "Release sign-off required";
  if (item.blocker) return null; // flightBlockerHtml already renders structured blockers
  return null;
}
```

Run `npm test -- flight-decision-label` — all computeReviewReason cases pass.

---

### Task 8 — Console UI: show review reasons (flightItemActions)

**File:** `src/daemon/console.ts`, `flightItemActions` function at line 1766

Replace the current review branch (line 1771):

```javascript
// BEFORE:
if (it.status === "review") b.push('<button class="primary-action" onclick="wpAccept(\''+esc(p.id)+'\',\''+esc(it.id)+'\')">Accept / Land</button>');
```

With:

```javascript
if (it.status === "review") {
  const reviewReason = _computeReviewReasonJs(it, p.loop);
  const reasonHtml = reviewReason
    ? '<div class="review-reason" style="font-size:11px;color:#888;margin-bottom:4px">'+esc(reviewReason)+'</div>'
    : '';
  b.push(reasonHtml + '<button class="primary-action" onclick="wpAccept(\''+esc(p.id)+'\',\''+esc(it.id)+'\')">Accept / Land</button>');
}
```

Add a helper just above `flightItemActions`:

```javascript
function _computeReviewReasonJs(it, loop) {
  if (it.taskStatus === "needs_input") return "Agent is waiting for your input";
  if (it.risk === "medium" || it.risk === "high")
    return (it.risk.charAt(0).toUpperCase() + it.risk.slice(1)) + "-risk change — operator sign-off required";
  if (loop && loop.profile === "release") return "Release sign-off required";
  return null;
}
```

Note: `it.taskStatus` must be included in the item payload sent from the server. Verify that `getWorkPackage` returns `taskStatus` on each item (or join it). If not, add a `taskStatus` field derivation from the linked task in the server response.

---

### Task 9 — Console tests: review-reason rendering

**File:** `src/daemon/console.test.ts`

Confirm the string `"review-reason"` (or "Agent is waiting" / "risk change") appears in rendered flight HTML for manual-review items:

| # | Scenario | Expected in HTML |
|---|---------|----------------|
| 1 | item with risk=medium, status=review | "Medium-risk change" substring |
| 2 | item with taskStatus=needs_input, status=review | "Agent is waiting" |
| 3 | item with risk=low, status=review, loop.profile=release | "Release sign-off" |
| 4 | item with risk=low, status=done (auto-landed) | no "Accept / Land" button |

---

### Task 10 — Verification gates

Run in order:

```bash
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

All must pass with zero errors/violations before committing.

---

## Non-goals

- No new API endpoint — auto-land fires inside `reconcileWorkPackage`.
- No retroactive auto-land of items already in `review`.
- No change to the `itemStatusForTask` mapping.
- No package-level "accept all" button.
- No change to `risk` on existing items.

---

## Verification Gates

1. `npm run typecheck` — zero errors
2. `npm test` — all tests passing
3. `node scripts/scope-wall.mjs` — zero violations
