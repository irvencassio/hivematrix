# Flight Child Autonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-29-flight-child-autonomy-design.md`

All tasks are RED → GREEN: write the failing test, run it, then the minimal code.
Verification after all tasks: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.

## Task 1 — Parent Context Pack (pure)

- [ ] File: `src/lib/work-packages/parent-context.ts` + `.test.ts`
- Exports:
  - `PARENT_CONTEXT_NO_VAGUE_QUESTIONS` (the verbatim instruction string).
  - `extractParentExamples(description: string): string[]` — clauses containing a
    `%`, a number+unit, a ratio (`100 / 7`), or an `e.g.`/`for example`/`acceptance`
    marker. Dedupe, cap at ~8.
  - `buildParentContextPack(parent, self, siblings): string`.
  - `buildChildTaskPrompt(parent, self, siblings): string` = pack + `\n\n=== Your task ===\n` + `self.prompt`.
- Tests: pack contains the full parent description; contains `7-day`/`14.3%`
  extracted examples; contains the no-vague-questions instruction; siblings listed
  with `[done]` / `[→ this item]`; `buildChildTaskPrompt` ends with the item prompt.

## Task 2 — Structured parent-decision blocker (pure)

- [ ] File: `src/lib/work-packages/parent-blocker.ts` + `.test.ts`
- Types: `ParentDecisionBlocker { ambiguity, parentExcerpt, options[], recommendedDefault, confidence }`.
- Exports:
  - `parseParentDecisionBlocker(text): ParentDecisionBlocker | null` — parse the
    `<<<NEEDS_PARENT_DECISION {json} NEEDS_PARENT_DECISION>>>` marker; tolerant of
    surrounding prose; returns null when absent/malformed.
  - `serializeParentBlocker(b): string` → `NEEDS_PARENT_DECISION:` + JSON.
  - `serializeOperatorEscalation(b, question): string` → `NEEDS_OPERATOR_DECISION:` + JSON `{question, options, recommendedDefault, ambiguity}`.
  - `readItemBlocker(blocker): { kind: "parent" | "operator", payload } | null`.
- Tests: round-trip parse/serialize; non-marker text → null; operator escalation
  read back as `kind:"operator"`.

## Task 3 — Coordinator auto-resolution (pure)

- [ ] File: `src/lib/work-packages/coordinator.ts` + `.test.ts`
- `resolveParentDecision(parent, blocker): ParentResolution` where
  `ParentResolution { resolved, answer?, reason, escalate?, escalateReason? }`.
- Strategy: find a concrete parent anchor for the ambiguity's key noun
  (period/window/value/threshold/day) in description + extracted examples; if the
  ambiguity says "period" and parent contains `7-day`, answer
  `Use the 7-day period; daily threshold = 100 / 7 = 14.3%`. Else accept a
  recommendedDefault grounded by a parent excerpt when `confidence >= 0.5`. Else
  escalate: `insufficient_context`, or `product_decision` (options match
  pricing/brand/copy/scope), or `destructive`/`safety` (reuse intake regexes).
- Tests: case 4 (7-day resolves, no escalation); case 5 (product-facing + no anchor
  → escalate with reason).

## Task 4 — Flight decision label (pure, shared with UI)

- [ ] File: `src/lib/work-packages/flight-decision-label.ts` + `.test.ts`
- `flightChildDecisionState(blocker): "parent_decision" | "operator_decision" | null`
  (sentinel prefix check). `flightDecisionLabel(state): string` →
  `Needs Flight decision` / `Needs your reply`.
- Tests: prefix→state→label mapping; null for plain/empty blocker.

## Task 5 — Wire Parent Context Pack into child task creation

- [ ] File: `src/lib/work-packages/store.ts` (`createTaskFromItem`)
- Build siblings from the package items; call `buildChildTaskPrompt(...)`; use the
  result as the created task `description`.
- Test (store.test.ts): create package with parent description containing `7-day`
  and `14.3%`, convert an item → the created task's description contains the parent
  description and the no-vague-questions instruction.

## Task 6 — Reconcile records parent-decision blocker; coordinator requeues

- [ ] File: `src/lib/work-packages/orchestrate.ts`
- In `reconcileWorkPackage`: when `next === "review"`, parse the linked task output
  via `parseParentDecisionBlocker`; if present, persist `serializeParentBlocker(...)`
  on the item via raw SQL.
- Add `coordinateFlightDecisions(packageId)`: for each review item whose blocker is
  a pending parent-decision, run `resolveParentDecision(parent, blocker)`. Resolved
  → append coordinator answer to the linked task description, requeue it
  (`status:"backlog", reviewState:null, error:null`), set item `running`, clear
  blocker (raw SQL). Escalate → set `serializeOperatorEscalation(...)` blocker (raw
  SQL), leave item in review.
- `advanceWorkPackage` calls `coordinateFlightDecisions` after `reconcileWorkPackage`.
- Tests (orchestrate.test.ts): case 3 (reconcile records needs_parent_decision, not
  plain review-only); case 4 (coordinate requeues with the 7-day answer); case 5
  (coordinate escalates a product decision, leaves operator blocker).

## Task 7 — ReviewState typing support

- [ ] File: `src/lib/tasks/review-state.ts` + `.test.ts`
- Add `needs_parent_decision` to `ReviewState`; `getReviewStateMeta` returns
  `{ label: "Needs Flight decision", tone: "review" }` for it.
- Test: meta mapping for the new value.

## Task 8 — Console UI two states

- [ ] File: `src/daemon/console.ts` (flight item render, ~line 1772)
- When `it.blocker` is a `NEEDS_PARENT_DECISION:` sentinel → badge
  `Needs Flight decision` (review tone, no operator action). When
  `NEEDS_OPERATOR_DECISION:` → `Needs your reply` with the question + options.
  Plain blocker text keeps the existing `.errbox`.
- Test (`src/daemon/console-flight-decision.test.ts`): grep console.ts source for
  both labels and the sentinel-prefix branch.
