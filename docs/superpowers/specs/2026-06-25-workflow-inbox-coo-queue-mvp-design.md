# Workflow Inbox / COO Queue MVP — Design

> Date: 2026-06-25 · Status: approved (scope set by operator prompt) · Topic: workflow-inbox-coo-queue-mvp
> Builds on commit `f8ee425` (Workflow Review Gate MVP).

## Problem

Pending workflow work is scattered across runs, actions, and several console panels. We
add one **read-only** Workflow Inbox / COO Queue answering: what needs review, what's
ready to execute, what's blocked, what failed, and what recently completed.

## Non-goals / guardrails

- No new workflows, no automatic execution, no workflow-graph visualization, no Browser
  Lane execution changes, no approval bypasses. No mail/message/desktop/terminal
  execution; no destructive Bee→Lane cleanup, `WorkerKind` flips, `DesktopBeeHelper.app`
  rename, or module sweeps.
- The inbox read path **never executes** anything and never leaks secret-looking artifact
  keys/values (it surfaces titles, statuses, ids, field names, system reasons — never
  artifact content). HeyGen pipeline stays green (`verify:portal` 9/9).

## Design

### 1. Shared action assessment (`actions.ts`)
Extract `assessWorkflowAction(action, operatorInputs?)` — pure, read-only, **no dispatch**.
Returns `{ readiness, sourceRunId, missing?, reason?, merged }` where readiness ∈
`ready | review_required | needs_input | completed | refused | failed | unsupported |
invalid`. It applies the **same review gate** (`isWorkflowRunReviewBlocked`) and the same
required-input check as `executeWorkflowAction`. `executeWorkflowAction` is refactored to
call it first (using `merged` for dispatch) so inbox readiness and execution agree.

### 2. Inbox service (`src/lib/workflows/inbox.ts`, read-only aggregator)
`getWorkflowInbox({ workflowId?, limit? })` → `{ counts, groups }` over `listWorkflowRuns`
+ `listWorkflowActions`. Groups (fixed order):
`needs_review · changes_requested · proposed_actions_ready · proposed_actions_blocked ·
failed_or_attention · running_or_pending · recently_completed`.
- Runs → group by status (needs_review / changes_requested / rejected|failed|blocked →
  attention / done|published → completed / else → running_or_pending).
- Actions → group by `assessWorkflowAction(...).readiness` (ready → ready; review_required
  | needs_input → blocked with `blockedReason`; completed → completed; refused|failed|
  unsupported|invalid → attention).
- `InboxItem { kind: run|action, id, workflowId, title, status, sourceRunId?,
  targetWorkflowId?, reason?, blockedReason?, createdAt?, updatedAt?, completedAt?,
  nextAction }`. Titles/reasons defensively secret-scrubbed; **no artifact content**.
  Deterministic (no generatedAt; list order is `createdAt DESC, rowid DESC`).

### 3. Endpoint
`GET /workflows/inbox?workflowId=&group=&limit=` — deterministic, secret-free.

### 4. Console
A compact "Workflow inbox" panel: counts by group, then items in actionable order
(needs_review → changes_requested → proposed_actions_ready → proposed_actions_blocked →
failed_or_attention → running_or_pending → recently_completed). Ready actions show
**Execute** (reuses `executeWorkflowAction`); blocked actions show the **reason** (no dead
button); review items point at the existing script-review controls.

### 5. Model-facing tool (`lane-tools.ts`)
New `workflow_inbox` lane tool (gated on `coo_router`, like `coo_dispatch` → available in
all modes). Read-only: builds the inbox and returns a concise operational summary
("2 need review · 1 action ready · 1 blocked (needs input)"). Never executes; never
includes artifact content. `formatWorkflowInboxSummary(inbox)` is the pure renderer.

### 6. Morning briefing (`briefing.ts`, `command-turn.ts`)
`buildVoiceBriefing` gains a `workflowInbox` line (compact: reviews needing attention,
ready actions, failed/blocked count). `composeBriefing` gathers the counts from
`getWorkflowInbox` (read-only). No artifact previews.

## Tests (RED first)
- `assessWorkflowAction` agrees with execute (ready/review_required/needs_input/completed).
- empty inbox → stable empty groups + zero counts.
- script needs_review run → `needs_review`; unapproved HeyGen action → blocked
  (`review_required`); approved script action → ready; missing-input action → blocked with
  exact fields; rejected/changes_requested/failed → attention groups.
- inbox JSON never contains secret-looking keys/values.
- `formatWorkflowInboxSummary` concise + secret-free; briefing line; console source.
- `npm run verify:portal` still 9/9.

## Verification
`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` · `npm run verify:portal` — all green.
