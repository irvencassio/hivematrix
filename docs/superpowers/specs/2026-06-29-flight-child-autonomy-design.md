# Flight Child Autonomy — Design

> Status: approved-for-build (brainstorming complete)
> Date: 2026-06-29
> Topic: Stop Flight child tasks from asking the operator for context the parent already contains.

## Problem

When an operator opens a Flight (Work Package) with a clear, example-rich parent
request, intake decomposes it into small child items whose prompts are isolated
fragments. The child task loses the parent's context, so the child worker asks the
operator vague clarification questions whose answers were already in the parent.

Observed parent request (abridged):

> "for the Usage information in the right panel. For the 7-day, you need to display
> green/yellow/red based on the % to the number of days in. … if we are on day 1 of
> the 7-day … and usage is at 15% of the weekly, then show red (14.3% is the amount
> per day). … if we are on day 7 and usage is 82%, we should be green (less than 6
> days max of 85.7%). See if that makes sense and ask questions if not."

Decomposed children received prompts like *"Calculate the daily usage threshold by
dividing 100 by the total number of days in the selected period."* and then asked
the operator *"What period are you referring to?"* / *"Which values did you have in
mind?"* — even though the parent specified the 7-day window, 14.3%, 82%, 85.7%.

This is the wrong behavior: the operator should never re-answer context that lives
in the parent Flight.

## Goals

1. Every Flight child task receives a **Parent Context Pack** in its prompt.
2. Children are instructed to infer from parent context before asking the operator.
3. When genuinely uncertain, a child returns a structured **parent-level blocker**
   (`needs_parent_decision`) rather than escalating `needs_input` to the operator.
4. The Flight coordinator tries to **auto-resolve** child blockers from the parent
   context, requeuing the child with a parent-derived answer.
5. The operator is escalated to **only** when the parent context is genuinely
   insufficient, the decision is product/business-facing, or the action is
   destructive/credentialed/safety-relevant.
6. The console distinguishes **"Needs your reply"** (true operator decision) from
   **"Needs Flight decision"** (child-worker ambiguity the coordinator may answer).
7. Flight **Advance** can retry/requeue a child with the parent-derived recommended
   answer.

## Non-goals

- No change to intake classification, risk gating, or concurrency policy.
- No new model calls on the hot path — the coordinator's auto-resolution is a
  deterministic text/keyword match over the parent context, mirroring the existing
  "deterministic policy — no LLM" stance of orchestration.
- No broad refactors outside work-packages / Flight orchestration, child prompt
  construction, blocker handling, and console UI.

## Design

### 1. Parent Context Pack (prompt construction)

New pure module `src/lib/work-packages/parent-context.ts`:

```ts
export interface ParentContextSource {
  title: string;            // parent Flight title
  description: string;      // full parent Flight description
  intake?: Record<string, unknown> | null; // for goalFlight criteria / examples
}
export interface SiblingSummary {
  title: string;
  status: string;
  done: boolean;
  summary?: string | null;  // commitHash / output summary when available
}

/** Extract concrete examples/numbers/criteria from the parent description. */
export function extractParentExamples(description: string): string[];

/** Render the Parent Context Pack block prepended to a child task description. */
export function buildParentContextPack(
  parent: ParentContextSource,
  self: { title: string; prompt: string },
  siblings: SiblingSummary[],
): string;

/** Full child task description = context pack + the item's own prompt. */
export function buildChildTaskPrompt(
  parent: ParentContextSource,
  self: { title: string; prompt: string },
  siblings: SiblingSummary[],
): string;
```

`extractParentExamples` pulls out lines/sentences containing numbers, percentages,
ratios, or explicit "for example / e.g. / acceptance" markers — the concrete
anchors (`7-day`, `14.3%`, `82%`, `85.7%`) the children must not lose. Plus any
`goalFlight.successCriteria` / `constraints` from intake.

`buildParentContextPack` renders a stable, labelled block:

```
=== Parent Flight Context (do not lose this) ===
Flight: <parent title>

Parent request:
<full parent description>

Concrete examples / acceptance criteria from the parent:
- 7-day window; 14.3% = per-day budget (100 / 7)
- day 7 at 82% → green (< 6-day max of 85.7%)

This Flight's other items:
1. [done] Step one — <summary>
2. [→ this item] <self title>
3. [pending] Step three

How to proceed:
- This task is one step of the parent Flight above. Infer any unstated value,
  period, or threshold from the parent request and examples before asking.
- Do NOT ask the operator for clarification if the parent context gives a
  reasonable default. Use the parent context and proceed.
- If you are genuinely blocked and the parent context does not resolve it, do NOT
  ask the operator. Instead emit a parent-decision blocker (status
  needs_parent_decision) with: the ambiguity, the relevant parent excerpt,
  2-3 options, your recommended default, and a confidence 0-1.
=== Your task ===
<the item's own prompt>
```

`createTaskFromItem` (store.ts) calls `buildChildTaskPrompt(...)` instead of using
the bare `itemRow.prompt` as the task description. Siblings come from the same
package's items (already loaded for the package). Completed sibling summaries use
`commitHash` / linked task title when present.

### 2. Structured parent-decision blocker

A child worker that cannot infer a value emits a structured marker instead of an
operator question. We reuse the existing `awaiting` signal channel but add a new
`kind`:

- `src/lib/tasks/review-state.ts` gains `ReviewState = "needs_input" |
  "ready_for_review" | "needs_parent_decision"`.
- New pure module `src/lib/work-packages/parent-blocker.ts`:

```ts
export interface ParentDecisionBlocker {
  status: "needs_parent_decision";
  ambiguity: string;
  parentExcerpt: string;
  options: string[];
  recommendedDefault: string;
  confidence: number; // 0..1
}
export function parseParentDecisionBlocker(text: string): ParentDecisionBlocker | null;
export function isParentDecisionBlocker(reviewState: string | null): boolean;
```

When a Flight child reaches `review` with a `needs_parent_decision` payload, the
item's `blocker` column records the serialized blocker and the item is held for the
**coordinator**, not surfaced as an operator reply. Concretely, `orchestrate.ts`
`reconcileWorkPackage` detects this state and routes it to coordinator
auto-resolution (section 3) rather than leaving it as a plain `review` awaiting the
operator.

### 3. Coordinator auto-resolution

New pure module `src/lib/work-packages/coordinator.ts`:

```ts
export interface ParentResolution {
  resolved: boolean;
  answer?: string;        // text to requeue the child with
  reason: string;         // why resolved / why escalated
  escalate?: boolean;     // true → operator decision required
  escalateReason?: "insufficient_context" | "product_decision" | "destructive" | "safety";
}

/** Try to answer a child's parent-decision blocker from the parent context alone. */
export function resolveParentDecision(
  parent: ParentContextSource,
  blocker: ParentDecisionBlocker,
): ParentResolution;
```

Resolution strategy (deterministic, no model):
1. Tokenize the ambiguity for the key noun(s) ("period", "value", "threshold",
   "window", "day").
2. Search the parent description + extracted examples for a matching concrete
   anchor (e.g. ambiguity mentions "period" → parent contains "7-day" → answer
   "Use the 7-day period; daily threshold = 100 / 7 = 14.3%").
3. If the blocker's `recommendedDefault` is itself grounded by a parent excerpt and
   `confidence >= 0.5`, accept the recommended default.
4. Escalate (`escalate: true`) only when:
   - no parent anchor found AND no usable recommended default →
     `insufficient_context`
   - the ambiguity/options imply a product/business choice (regex over options:
     pricing, brand, copy, scope, "which feature") → `product_decision`
   - the action is destructive/credentialed/safety (reuse intake's
     `DESTRUCTIVE_RE` / `CREDENTIALED_RE`) → `destructive` / `safety`

When `resolved`, the orchestrator requeues the child: append the coordinator answer
to the child task description (reuse `appendReplyContinuation` with an
`--- Flight coordinator answer ---` marker), clear the item `blocker`, move the item
back to `running`, and re-create/continue the linked task. When `escalate`, the
item stays in `review` and the operator-facing question is surfaced (section 4).

### 4. Operator escalation (unchanged path, clarified copy)

Escalation continues to use the existing `review` + `needs_input` operator-reply
flow. The difference is *which* blockers reach it: only those the coordinator
escalated. The operator question is built from the blocker (ambiguity + options +
recommended default) so the operator sees a crisp, high-level decision.

### 5. Console UI: two distinct states

- A child item whose blocker is a coordinator-escalated operator decision shows
  **"Needs your reply"** (existing attention styling).
- A child item with a `needs_parent_decision` blocker still being worked by the
  coordinator shows **"Needs Flight decision"** (new badge, `review` tone), making
  clear the operator does not need to act.
- Advance gains the ability to requeue a child with the parent-derived recommended
  answer (existing Advance button drives `advanceWorkPackage`, which now performs
  coordinator auto-resolution during reconcile).
- A coordinator-escalated operator decision renders one-click pick buttons in the
  Flight item: a primary **"✓ Accept recommended: <default>"** plus a button per
  remaining option. Each sends the chosen text to the existing
  `POST /tasks/:id/reply` requeue path (`wpAcceptDecision`), so the operator never
  has to retype an answer the worker already proposed; a custom reply is still
  available from the task itself. The answer is `attrEnc`-encoded for safe inlining
  in the onclick attribute (`esc()` only escapes `&<>`).

## Data / schema impact

- No new SQL columns. The `work_package_items.blocker` TEXT column stores the
  serialized blocker payload (it already stores failure blockers). Two sentinel
  prefixes distinguish the new states from a plain failure blocker:
  - `NEEDS_PARENT_DECISION:<json>` — child asked for a value; coordinator owns it.
  - `NEEDS_OPERATOR_DECISION:<json>` — coordinator escalated; operator owns it.
  Structured blockers are persisted via **raw SQL** (like the existing failure
  blocker write in `reconcileWorkPackage`), never through `updateWorkPackageItem`,
  because that path runs `scrubSecretText` which would corrupt the JSON.
- `reviewState` TEXT on tasks gains a third value string (`needs_parent_decision`);
  no migration needed (free-text column).
- A child signals a parent decision by emitting a fenced marker in its final output:
  `<<<NEEDS_PARENT_DECISION {json} NEEDS_PARENT_DECISION>>>`. `reconcileWorkPackage`
  parses it from `task.output` and records the sentinel blocker on the item instead
  of leaving a bare operator `needs_input`.

## Testing (TDD — failing tests first)

1. **Child prompt includes parent context** — `buildChildTaskPrompt` /
   `createTaskFromItem`: child description contains the parent description and the
   extracted `7-day` / `14.3%` examples.
2. **Child prompt discourages vague human questions** — asserts the instruction
   "Do not ask the operator for clarification if the parent context gives a
   reasonable default. Use the parent context and proceed." is present.
3. **Structured parent blocker** — a child that cannot infer a value records a
   `needs_parent_decision` blocker on the item (not a plain operator `needs_input`).
4. **Coordinator auto-resolution** — ambiguity "What period?" + parent "7-day"
   resolves to "Use 7-day; daily threshold = 100 / 7 = 14.3%", `resolved: true`,
   no operator escalation; item requeues to `running`.
5. **Operator escalation remains** — product-facing ambiguity with no parent anchor
   → `escalate: true`, operator question carries options + recommended default.
6. **UI copy** — console renders "Needs Flight decision" for a parent-resolvable
   child blocker and "Needs your reply" for a true operator decision.

## Verification gates

- `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs` all pass.

## Rollback

All behavior is additive. Removing `buildChildTaskPrompt` (reverting to
`itemRow.prompt`) and the coordinator hook restores prior behavior with no schema
change.
