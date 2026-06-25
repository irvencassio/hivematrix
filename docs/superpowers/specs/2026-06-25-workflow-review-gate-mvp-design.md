# Workflow Review Gate MVP — Design

> Date: 2026-06-25 · Status: approved (scope set by operator prompt) · Topic: workflow-review-gate-mvp
> Builds on commit `61e2edc` (Script Draft Workflow MVP).

## Problem

`needs_review` runs currently don't actually gate anything — a downstream proposed action
(e.g. the script run's HeyGen proposal) can execute before a human approves the draft. We
make review/approval real and **generic**: downstream actions from review-required runs
can't execute until the source run is approved, and operators can revise the draft
artifact before approving — with the revised content used at execution time.

## Non-goals / guardrails

- No new workflows, no visual graph, no automatic publishing, no Browser Lane task
  creation unless the existing HeyGen path is explicitly invoked. No mail/message/desktop/
  terminal execution. No destructive Bee→Lane cleanup, `WorkerKind` flips,
  `DesktopBeeHelper.app` rename, or module sweeps.
- Additive DB migration only. No secrets in review notes / revised artifacts / API / console.
- HeyGen pipeline stays green (`verify:portal` 9/9 — the harness doesn't go through actions,
  so the gate doesn't affect it).

## Design

### 1. Review state (additive migration + `runs.ts`)
- ALTER `workflow_runs` ADD `reviewDecision`, `reviewNote`, `reviewedAt`,
  `reviewedArtifacts_json`. ALTER `workflow_actions` ADD `source_artifact_map_json`.
- `reviewWorkflowRun(id, decision, { note?, reviewedArtifacts? })` — decision
  `approve | request_changes | reject` → status `approved | changes_requested | rejected`;
  stores a secret-scrubbed note + reviewedAt + reviewed keys; appends a `review.*` event.
- `isWorkflowRunApproved(run)` = `reviewDecision === "approve"`.
  `isWorkflowRunReviewBlocked(run)` = status ∈ {needs_review, changes_requested, rejected}
  AND not approved.

### 2. Artifact revision (`runs.ts`)
- `reviseWorkflowRunArtifact(id, key, value)` — snapshots the original once
  (`<key>_original`), stores the **secret-scrubbed** new value, appends an
  `artifact.revised` event. Touches only that key (+ its `_original`) — never unrelated
  artifacts.

### 3. Gate + fresh inputs (`actions.ts`)
- `proposeWorkflowAction` gains `sourceArtifactMap?: Record<string,string>` (target input →
  source-run artifact key), stored on the action.
- `executeWorkflowAction`:
  - Load the source run. If `isWorkflowRunReviewBlocked(sourceRun)` → return
    `{ ok:false, status:"review_required", actionId, sourceRunId, reason }` — **no target
    execution**.
  - Resolve `sourceArtifactMap` from the **current** source-run artifacts → these override
    stale `suggestedInputs` (so a revised script is used, not the original). Operator inputs
    still override everything.
  - (existing needs_input + dispatch unchanged.)
- Non-review source runs (or no source run) are unaffected.

### 4. Script workflow handoff (`video-script.ts`)
The HeyGen proposal's reason says it **requires script approval**, and it carries
`sourceArtifactMap { script: "scriptText", title: "title" }`. So once the script run is
approved (and possibly revised), executing it uses the approved/revised script.

### 5. Endpoints
- `POST /workflows/runs/:id/review` `{ decision, note?, reviewedArtifacts? }`.
- `POST /workflows/runs/:id/artifact` `{ key, value }` — allowlisted keys (`scriptText`,
  `scriptMarkdown`).
- `/workflows/actions/:id/execute` now enforces the gate (returns `review_required`).

### 6. Console + model
- Script preview becomes editable (textarea) with **Save revision**; **Approve /
  Request changes / Reject** controls on the run. A blocked execute shows `review_required`.
- Model-facing distinctions: draft prepared (`isDraft`, needs_review) · review required
  (execute result) · approved and ready (run status `approved`).

## Tests (RED first)
- script run starts `needs_review`.
- executing the HeyGen action from an unapproved script run → `review_required`, **no
  dispatch** (target run count unchanged).
- revised script is stored redacted with an `artifact.revised` event + `_original` kept.
- approving unlocks execution; the executed action uses the **revised** script.
- reject / request_changes keep the action blocked.
- the brief→script chain now approves the brief first (generic gate); console source has
  the review/revise controls; `npm run verify:portal` still 9/9.

## Verification
`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` · `npm run verify:portal` — all green.
