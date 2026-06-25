# Workflow Action Handoff MVP — Design

> Date: 2026-06-25 · Status: approved (scope set by operator prompt) · Topic: workflow-action-handoff-mvp
> Builds on commit `4533d29` (content.research_brief workflow).

## Problem

A workflow run already *suggests* a next action in prose, but there's no durable,
executable handoff. We add a **generic** action/proposal model: any run can propose a
next workflow, and an operator/model can explicitly execute it — routed through the
registered workflow's handler, never bespoke per-target code.

## Non-goals / guardrails

- No browser clicking / credential injection / Playwright / posting / publishing. No
  mail/message/desktop/terminal execution. No destructive Bee→Lane cleanup, `WorkerKind`
  flips, `DesktopBeeHelper.app` rename, or module sweeps.
- **Nothing auto-executes.** Proposing a brief never creates a HeyGen task or calls an
  external service. Execution is always explicit.
- No secrets in proposals/events/API/console. HeyGen pipeline stays green (verify:portal 9/9).

## Design

### 1. Schema (additive migration v22) + store (`src/lib/workflows/actions.ts`)
- `workflow_actions(_id, sourceRunId, targetWorkflowId, title, reason, required_inputs_json,
  suggested_inputs_json, status, resultRunId, createdAt, updatedAt)` + index on
  `(sourceRunId, createdAt)`. status: `proposed | accepted | completed | refused | failed`.
- `proposeWorkflowAction(input)` — validates `targetWorkflowId` exists in the registry;
  `requiredInputs` default = the target def's required input field names; **redacts**
  suggested inputs (key-based). `listWorkflowActions({sourceRunId?, status?})`,
  `getWorkflowAction(id)`, `updateWorkflowActionStatus(id, status, {resultRunId?})`.
- `executeWorkflowAction(id, inputs, deps?)` — generic: merge the target's schema-matched
  suggested inputs with operator inputs; if any required field is still missing → return
  `{ ok:false, status:"needs_input", missing }` (proposal stays proposed). Otherwise call
  `prepareWorkflowById(targetWorkflowId, merged)` (the **registered handler path**), mark
  the action `completed` with `resultRunId`, and append an event to the source run.
  `deps.prepare` is injectable (default `prepareWorkflowById`, dynamic-imported to avoid a
  cycle).

### 2. Generic prepare dispatcher (`src/lib/workflows/prepare.ts`)
`prepareWorkflowById(workflowId, inputs)` — the single place the prepare endpoint AND
action execution use:
- unknown id → `{ ok:false, status:"unsupported" }`.
- missing required inputs (from `def.inputSchema`) → `{ ok:false, status:"needs_input",
  missing }` (exact field names, no guessing).
- dispatch by `def.handler`: `content-research-brief` → `prepareContentResearchBrief`;
  `heygen-portal-video` → `dispatchHeyGenVideoWorkflow` **prepare** (no create).
- The `/workflows/:id/prepare` endpoint is refactored to call this (DRY).

### 3. content.research_brief proposes a HeyGen action
`prepareContentResearchBrief` calls `proposeWorkflowAction` once the run + brief exist:
target `heygen.portal_video_from_script`, title `Video: <topic>`, reason, and
`suggestedInputs { title: "Video: <topic>", scriptDraft: <brief excerpt> }`. **`scriptDraft`
is a clearly-marked draft, not `script`** — so executing without a real script returns
`needs_input ["script"]`. No HeyGen task is created. The prepare result returns the
proposed action (model-facing "next action").

### 4. Endpoints + console
- `GET /workflows/runs/:id/actions`, `GET /workflows/actions` (recent proposed),
  `POST /workflows/actions/:id/execute` (body = inputs). Secret-free.
- `GET /workflows/runs/:id` returns `{ run, actions }`.
- Console Workflows panel: a "Proposed next actions" list with an explicit **Execute**
  button (`executeWorkflowAction`); `needs_input` shows the missing fields.

## Tests (RED first)
- schema columns; store: propose validates target (throws unknown) + redacts; list/get/update.
- `executeWorkflowAction`: insufficient inputs → `needs_input ["script"]` (NOT bespoke
  HeyGen — goes through the generic handler path / injected prepare); sufficient → calls
  `prepare` once, marks completed + resultRunId.
- `prepareWorkflowById`: needs_input for missing fields; dispatches the brief handler.
- content brief creates a proposed action and does **not** auto-execute it; proposal redacted.
- console source has the execute control; API source declares the routes.
- `npm run verify:portal` still 9/9.

## Verification
`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` · `npm run verify:portal` — all green.
