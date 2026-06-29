# Flight Auto-Land Design

> **Date:** 2026-06-29
> **Status:** Approved for implementation

## Problem

The current Flight detail view leaves low-risk completed child items in `review` with an `Accept / Land` button. This is review theater: the operator cannot meaningfully assess micro-items like "identify handler" or "update clear button handler" from the card UI. Every review item carries the same button regardless of whether there is a real decision to make.

Root causes:
1. `reconcileWorkPackage` maps **both** task `review` and `needs_input` to item `review` — identical item status for very different situations.
2. Nothing distinguishes a clean agent self-report ("I'm done, please accept") from a genuine open question ("I need your input to proceed").
3. The UI renders `Accept / Land` for all review items with no explanation of what the operator is accepting or why their decision is required.

---

## Goals

1. **Auto-land low-risk, clean review items** without operator action.
2. **Preserve manual review** for items with a real decision (risk, failure, question, loop sign-off).
3. **Show review reasons** so manual-review items explain themselves instead of showing only a button.

---

## Data Model (unchanged)

```
WorkPackageItem {
  status:        "draft" | "held" | "ready" | "running" | "review" | "done" | …
  risk:          "low" | "medium" | "high"
  blocker:       null | plain text | NEEDS_PARENT_DECISION:{…} | NEEDS_OPERATOR_DECISION:{…}
  executionMode: "sequential" | "worktree_parallel" | "safe_parallel" | "hold"
  taskStatus:    string | null   ← live-joined from linked task
}
```

A task enters `review` when the agent considers its work done and checkpoints for review,  
or `needs_input` when it is actively waiting for operator input.

Both currently produce item status `review` via `itemStatusForTask` in `orchestrate.ts:117`.

---

## Auto-Land Predicate

A new pure function `shouldAutoLand(item, actualTaskStatus, loop)` returns `{ autoLand: boolean, reason: string }`.

**Auto-land when ALL of the following are true:**

| # | Condition | Rationale |
|---|-----------|-----------|
| 1 | `item.risk === "low"` | Medium/high risk requires human judgment by policy. |
| 2 | `actualTaskStatus === "review"` | Agent reported "done, please accept." `needs_input` means it is waiting for the operator — never auto-land. |
| 3 | `item.blocker === null` | A structured blocker (parent decision, operator escalation, plain failure text) means the item has an open question. |
| 4 | `item.executionMode !== "hold"` | Held items are explicitly final-gated by the operator. |
| 5 | `loop === null \|\| loop.profile !== "release"` | Release-profile loops require sign-off on every item. Other loop profiles (quality, goal_quality, watch) create follow-up items but don't gate individual acceptance. |

If ANY condition is false, the item stays in `review` for manual action.

**Why not block on loop existence?**  
All Flights created via `readyWorkPackage` get a `self_paced` `quality` loop. The loop creates new follow-up items — it does not gate acceptance of the current item. Blocking auto-land on loop existence would defeat the feature for 100% of normal Flights. Only the `release` profile is genuinely a sign-off loop.

**Why `needs_input` ≠ auto-landable?**  
`needs_input` is the explicit signal that the agent cannot proceed without operator data (think: "what API key should I use?" or "which endpoint?"). Auto-landing that would discard an unanswered question.

---

## What Stays in Manual Review

| Trigger | Reason shown in UI |
|---------|-------------------|
| `risk === "medium"` or `"high"` | "Medium/high-risk change — operator sign-off required" |
| `taskStatus === "needs_input"` | "Agent is waiting for your input" |
| `blocker` is `NEEDS_OPERATOR_DECISION:…` | Already shown by `flightBlockerHtml` (✋ Needs your reply) |
| `blocker` is plain text | Shown as error box — failure or manual note |
| `loop.profile === "release"` | "Release sign-off required" |

---

## Implementation Plan

### 1. `shouldAutoLand` predicate (`src/lib/work-packages/orchestrate.ts`)

New pure function:

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

### 2. `reconcileWorkPackage` modification (`src/lib/work-packages/orchestrate.ts`)

When `raw === "review"`, check `shouldAutoLand` before writing `review` to the DB.  
If auto-land: write `done`, archive the linked task, log an info line.

```
// pseudocode inside reconcileWorkPackage:
if (next === "review") {
  const actualTaskStatus = String((task as any).status);
  const loop = getLoop(id);
  const { autoLand, reason } = shouldAutoLand(item, actualTaskStatus, loop);
  if (autoLand) {
    // write done directly, archive task
    next = "done";
    // archive the linked task (same as acceptWorkPackageItem does)
    await Task.findByIdAndUpdate(item.createdTaskId, { status: "archived" });
    console.info(`[work-packages] auto-landed item ${item.id}: ${reason}`);
  }
}
// then continue with normal status write
```

This is the earliest possible interception: the item never surfaces in `review` to the client. No new API endpoint needed.

### 3. `computeReviewReason` utility (`src/lib/work-packages/flight-decision-label.ts`)

New exported function:

```typescript
export function computeReviewReason(
  item: Pick<WorkPackageItem, "risk" | "blocker" | "taskStatus" | "executionMode">,
  loop: FlightLoop | null,
): string | null {
  if (item.taskStatus === "needs_input") return "Agent is waiting for your input";
  if (item.risk === "medium" || item.risk === "high") return `${item.risk.charAt(0).toUpperCase() + item.risk.slice(1)}-risk change — operator sign-off required`;
  if (loop && loop.profile === "release") return "Release sign-off required";
  if (item.blocker) return null; // flightBlockerHtml already renders the structured blocker
  return null; // no plain-language reason (shouldn't reach Accept / Land in auto-land world)
}
```

The function returns a compact plain-text reason. `null` means the blocker HTML already explains the situation.

### 4. Console UI changes (`src/daemon/console.ts`)

In `flightItemActions(p, it)`, when `it.status === "review"`:

- Call `computeReviewReason` (server-side the item carries `taskStatus`; in the console JS, use `it.taskStatus` and `it.risk`).
- Render a compact `<div class="review-reason">…</div>` above the `Accept / Land` button.
- This gives the operator context for the items that genuinely need their attention.

```javascript
// In the console JS (inside flightItemActions):
if (it.status === "review") {
  const reason = computeReviewReasonJs(it, p.loop);
  const reasonHtml = reason
    ? '<div class="review-reason muted" style="font-size:11px;margin-bottom:4px">'+esc(reason)+'</div>'
    : '';
  b.push(reasonHtml + '<button class="primary-action" onclick="wpAccept(\''+esc(p.id)+'\',\''+esc(it.id)+'\')">Accept / Land</button>');
}
```

Where `computeReviewReasonJs` mirrors the TS function inline in the console JS (no module boundary in console.ts).

---

## Test Plan

### Unit tests — `shouldAutoLand` (pure, fast)

| Test | Expected |
|------|----------|
| low risk, task=review, no blocker, no loop | auto-land = true |
| medium risk, task=review | auto-land = false, reason mentions risk |
| high risk, task=review | auto-land = false |
| low risk, task=needs_input | auto-land = false, reason mentions input |
| low risk, task=review, blocker non-null | auto-land = false |
| low risk, task=review, loop.profile=release | auto-land = false |
| low risk, task=review, loop.profile=quality | auto-land = true (loop doesn't block) |

### Integration tests — `reconcileWorkPackage`

| Test | Expected |
|------|----------|
| item running→task moves to review, risk=low, no blocker | item lands as done automatically; linked task archived |
| item running→task moves to needs_input | item becomes review, stays for manual action |
| item running→task moves to review, risk=medium | item becomes review, stays for manual action |
| item running→task moves to review, release loop | item becomes review, stays for manual action |
| item already in review manually accepted via `acceptWorkPackageItem` | still works (manual path unchanged) |

### Integration test — `advanceWorkPackage` / `acceptWorkPackageItem`

| Test | Expected |
|------|----------|
| auto-landed item unblocks a dependent ready item | package advances correctly after auto-land |
| manual accept of a medium-risk review item | `acceptWorkPackageItem` still works end-to-end |

---

## Verification Gates

1. `npm run typecheck` — zero errors
2. `npm test` — all tests passing
3. `node scripts/scope-wall.mjs` — zero violations

---

## Non-Goals

- Do not change the `itemStatusForTask` mapping — `needs_input` and `review` staying unified at the DB mapping level is fine; the predicate differentiates via `actualTaskStatus`.
- Do not add a new `/auto-accept` API endpoint — auto-land happens inside reconcile.
- Do not add a package-level "auto-accept all" button — the predicate runs per-item at reconcile time.
- Do not change the `risk` field on existing items automatically.

---

## Migration / Rollout

No schema migration needed. The predicate is purely additive logic in `reconcileWorkPackage`. Existing flights in review are not retroactively auto-landed — auto-land fires only when an item transitions into review after this change ships. Operators can still manually accept any review item at any time.
