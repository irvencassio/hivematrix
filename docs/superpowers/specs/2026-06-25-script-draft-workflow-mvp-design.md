# Script Draft Workflow MVP — Design

> Date: 2026-06-25 · Status: approved (scope set by operator prompt) · Topic: script-draft-workflow-mvp
> Builds on commit `1472db1` (Workflow Action Handoff MVP).

## Problem

Research brief → HeyGen video skips the actual script-writing step; the brief proposes a
HeyGen action but execution returns `needs_input ["script"]`. We add a first-class
**script-development** workflow in the middle:
`research brief → script draft → human review → HeyGen action with a real script`.

## Non-goals / guardrails

- No browser clicking / credential injection / Playwright / posting / publishing / Browser
  Lane task creation. No mail/message/desktop/terminal execution. No destructive Bee→Lane
  cleanup, `WorkerKind` flips, `DesktopBeeHelper.app` rename, or module sweeps.
- **No new generic workflow infrastructure** unless a test forces it — reuse registry, run
  ledger, action proposals, and the generic prepare dispatcher.
- No external side effects; no secrets in artifacts/proposals/API/console.
- HeyGen pipeline stays green (`verify:portal` 9/9).

## Design

### 1. Workflow definition (`src/lib/workflows/video-script-def.ts`, def-only)
- `id: "content.video_script_from_brief"`, name "Video script from brief".
- `lane: "review"`, `capability: "content.script"`, `handler: "content-video-script"`.
- `inputSchema`: `topic` (required); `audience`, `objective`, `briefMarkdown`, `sourceRunId`,
  `tone`, `duration` (optional). The "either `briefMarkdown` or `sourceRunId`" rule is
  enforced in the handler (a `needs_input`/validation error, not a schema flag).
- `readiness.required: false`; `approvalPolicy.mode: "manual"` (human review the draft).
- runbook `docs/runbooks/content-research-brief.md` (shared content runbook section), tags
  research/content/script, phrases "video script" / "script from brief" / "draft a script".

### 2. Prepare helper (`src/lib/workflows/video-script.ts`)
- `buildVideoScriptText(input, context)` + `buildVideoScriptMarkdown(input, context)` —
  **pure, deterministic**, secret-scrubbed. Produces title, hook, beat outline, narration
  script, CTA, assumptions/open questions. The full markdown carries a clear **DRAFT**
  banner.
- `prepareVideoScriptFromBrief(input, deps?)` — resolves brief context (`briefMarkdown`, or
  load the `briefMarkdown` artifact from `sourceRunId`); requires `topic`; **errors if
  neither brief source is present**. Creates a run (`needs_review`) with artifacts
  (`scriptMarkdown`, `scriptText`, `title`, `hook`, `beats`, `cta`, `assumptions`).
- It **proposes a HeyGen action** with `suggestedInputs { title, script }` where `script` is
  the REAL draft narration — so executing that action *prepares* successfully (no
  `needs_input`), but still does **not** create a Browser Lane task (prepare-only).
- Returns `{ workflow, runId, title, script, markdown, proposedAction, isDraft: true }`.

### 3. Research brief handoff update (`src/lib/workflows/content-research.ts`)
The brief now proposes **`content.video_script_from_brief`** as the primary next action
(`suggestedInputs { topic, sourceRunId }`) — bridging to the script step instead of jumping
straight to HeyGen. Still proposed, never executed.

### 4. Dispatcher + endpoint (`prepare.ts`, server)
Add the `content-video-script` case to `prepareWorkflowById` (used by both
`/workflows/:id/prepare` and action execution). No endpoint change beyond the generic one.

### 5. Console + model
- Console: a "Prepare video script" control (topic + optional brief run) → the prepare
  endpoint; preview the script artifact; run detail shows the proposed HeyGen action.
- Model-facing: the prepare result clearly says the script is a **draft requiring review**
  (markdown DRAFT banner + `isDraft`).

## Tests (RED first)
- registry exposes `content.video_script_from_brief`.
- `buildVideoScript*` deterministic + scrubbed (no secrets).
- `prepareVideoScriptFromBrief` with `briefMarkdown` → run + `scriptMarkdown` artifact,
  `needs_review`, proposes HeyGen with real `script` + `title`.
- with `sourceRunId` (a brief run) → loads the brief artifact and prepares.
- neither brief source → validation/`needs_input` error.
- research brief proposes `content.video_script_from_brief`.
- chain: executing the brief's proposed action prepares a script run; executing the script's
  proposed HeyGen action prepares **without** creating a Browser Lane task.
- console source has the script prepare control; `npm run verify:portal` still 9/9.

## Verification
`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` · `npm run verify:portal` — all green.
