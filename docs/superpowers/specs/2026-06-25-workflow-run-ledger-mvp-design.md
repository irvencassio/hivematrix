# Workflow Run Ledger MVP — Design

> Date: 2026-06-25 · Status: approved (scope set by operator prompt) · Topic: workflow-run-ledger-mvp
> Builds on commit `c9f6ef4` (Workflow Registry MVP).

## Problem

Registered workflows are discoverable, but a *run* of one has no durable state beyond
draft-specific fields. We add a generic **Workflow Run Ledger** — runs + events +
artifacts + blockers — and link the HeyGen portal video workflow to it, while keeping
the existing draft fields for compatibility.

## Non-goals / guardrails

- No browser clicking / credential injection / Playwright. No mail/message/desktop/
  terminal execution. No destructive Bee→Lane cleanup, `WorkerKind` flips,
  `DesktopBeeHelper.app` rename, or module sweeps.
- **Additive DB migration only.** Never store secrets in run state/events/artifacts.
- Draft-specific behaviour stays compatible; `npm run verify:portal` must still pass.

## Design

### 1. Schema (additive migration, db/index.ts)
- `workflow_runs(_id, workflowId, status, title, lane, capability, parentTaskId,
  draftId, childTaskId, currentStep, blocker, artifact_json, runbook, createdAt,
  updatedAt, completedAt)` + indexes on `(workflowId, createdAt)` and `(draftId)`.
- `workflow_run_events(_id, runId, event, message, metadata_json, createdAt)` + index
  on `(runId, createdAt)`. Ordering uses `createdAt DESC, rowid DESC` (monotonic tiebreak).

### 2. Run store (`src/lib/workflows/runs.ts`)
- `createWorkflowRun(input)` — validates `workflowId` exists in the registry (throws
  otherwise); defaults lane/capability/runbook from the def; records a `created` event.
- `getWorkflowRun(id)` → record + events. `listWorkflowRuns({ workflowId?, draftId?, limit? })`.
- `updateWorkflowRunStatus(id, status, { blocker?, currentStep? })` — stamps `updatedAt`,
  sets `completedAt` for terminal states (done/failed/cancelled), appends an event.
- `appendWorkflowRunEvent(runId, event, message?, metadata?)` — redacts secret-looking metadata.
- `linkWorkflowRunArtifact(id, key, value)` — merges into `artifact_json` (redacted).
- `setWorkflowRunLinks(id, { draftId?, parentTaskId?, childTaskId? })`.
- `findWorkflowRunByDraft(draftId, workflowId?)` — latest run for a draft.
- All metadata/artifacts pass a **key-based secret redactor**.

### 3. HeyGen linkage (`src/lib/workflows/heygen-run-link.ts`)
One shared module the endpoints AND the verify harness call (no duplicated mapping):
- `linkHeyGenPortalRunOnDispatch(result, { draftId, title })` — find-or-create the
  draft's run; `created` → `portal_pending` (+ childTaskId); `readiness_required` /
  `execution_unavailable` → `blocked` (+ blocker = reason); links the dispatch auditId
  + readiness status as artifacts.
- `linkHeyGenPortalRunOnCompletion(draftId, { status, childStatus? })` — `portal_completed`
  / `needs_publish_input` / (failed|cancelled → terminal) on the run.
- `linkHeyGenPortalRunOnPublish(draftId, publishResult)` — `done` + `youtubeUrl` artifact.

### 4. Endpoints (`src/daemon/server.ts`)
- `/video/heygen-workflow` (create + dedupe) → `linkHeyGenPortalRunOnDispatch`.
- `/video/portal-complete` → `linkHeyGenPortalRunOnCompletion`.
- `/video/publish-draft` → `linkHeyGenPortalRunOnPublish`.
- `GET /workflows/runs`, `GET /workflows/runs/:id`, `GET /workflows/:id/runs` — secret-free.

### 5. Console (Workflows panel)
Show recent runs (status, draft/task links, key artifacts) under the workflow list. Compact.

### 6. verify:portal
The harness calls the same link functions at the portal-task / completion / publish
phases and adds a `run-ledger` phase asserting a run exists and transitioned
`portal_pending → portal_completed → done` with the YouTube artifact. No real side effects.

## Tests (RED first)
- schema: both tables exist with the expected columns.
- store: create validates workflowId (throws unknown); create/get/list/update/events;
  terminal sets completedAt; metadata + artifacts redacted; `rowid` tiebreak.
- linkage: dispatch (created → portal_pending run + childTaskId), completion
  (portal_completed / needs_publish_input / failed), publish (done + youtubeUrl artifact).
- API source declares the routes; run JSON has no secrets.
- `npm run verify:portal` 9/9.

## Verification
`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` · `npm run verify:portal` — all green.
