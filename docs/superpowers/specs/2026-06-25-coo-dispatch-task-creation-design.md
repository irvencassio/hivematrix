# COO Dispatch — Hardening + Explicit Task Creation — Design

> Date: 2026-06-25 · Status: approved (scope set by operator prompt) · Topic: coo-dispatch-task-creation
> Builds on commit `19ed2c4` (COO route-to-execution bridge). Extends
> `2026-06-25-coo-dispatch-bridge-design.md`.

## Problem

The COO dispatch bridge currently *prepares* a Browser-Lane work item but never
creates a real HiveMatrix task. Before wiring creation we harden the dispatch
surface (input validation + audit redaction), then add explicit, opt-in task
creation for Browser-Lane prepared results only.

## Non-goals / guardrails

- No destructive Bee→Lane cleanup, no persisted `WorkerKind` flips, no
  `DesktopBeeHelper.app` rename, no `src/lib/<x>bee/` module sweeps. Compatibility
  ids intact.
- `POST /coo/routing-rules/resolve` behavior unchanged.
- Default `POST /coo/dispatch` stays prepare-only. Creation is opt-in.
- Only Browser-Lane **prepared** results may create a task. `approval_required`,
  `unsupported`, `needs_input`, and `no_match` never create a task.
- Resolution/work-item building keep using the **original** request text; redaction
  applies only to what is *persisted in the audit*.

## Design

### 1. Input validation (`POST /coo/dispatch`)
- `text` must be a non-empty string after trim. Empty → **400**, and crucially
  **no audit row** is written.
- Enforced in two places: the endpoint returns 400; `dispatchCooRequest` throws
  `CooDispatchValidationError` *before* any `recordCooDispatchAudit` call
  (defense in depth — the library is safe regardless of caller).

### 2. Audit redaction
- New `redactSecrets(text)` applied to `requestText` and every string in
  `requestContext` *at persist time only*. Covers: `password|passwd|pwd|secret|
  token|api[-_]?key|apikey|access[-_]?key|<…>key` as `key=value` / `key: value`,
  and `Bearer <token>`. Over-redaction is acceptable in an audit log; under-redaction
  is not.
- Dispatch routing + the returned work item use the original text (behavior intact).

### 3. Explicit task creation
- `dispatchCooRequest(request, options?)` stays **sync** and prepare-only. New
  `options.projectPath` lets a prepared browser envelope carry a real
  `requestedProjectPath` instead of the project label.
- New async `dispatchCooTask(request, { create, projectPath, createTask })`:
  - Calls `dispatchCooRequest`. If `!create` or `status !== "prepared"` → returns
    the base result unchanged (no creation).
  - Otherwise invokes the injected `createTask` IO (testable without a live DB),
    sets `status: "created"`, returns `taskId`, and updates the audit row.
- `createTask` is injected. The daemon's real implementation reuses the existing
  Browser-Lane task pattern: `Task.create({ source:"browser-lane", executor:"agent",
  status:"backlog", model: envelope.backingModel, output:{ browserbeeRequest:
  envelope, coo:{ ruleId, capability } } })` with a description from
  `buildBrowserBeeTaskDescription`.

### 4. Task linkage + project path
- New status `"created"` and `taskId: string | null` on `CooDispatchResult`.
- Audit linkage: additive migration **v20** `ALTER TABLE coo_dispatch_audit ADD
  COLUMN taskId TEXT` (never edit v19). `taskId` is its own column — `envelopeId`
  stays in `workItemId`, not overloaded.
- **Project path is deliberate:** the literal `"hive"` fallback is removed. The
  job's `project` *label* defaults to `DEFAULT_TASK_PROJECT` ("inbox"). A real
  execution `projectPath` is **required only when creating a task** and is
  validated by the daemon via `normalizeHomeProjectPath` (must be under `$HOME`);
  missing/invalid → **400**, no task, no creation. Prepared (non-creating) results
  carry the label as `requestedProjectPath`, never a fake path.

## Daemon
- `POST /coo/dispatch` gains `create?: boolean` + `projectPath?: string`.
  - `create !== true` → prepare-only (today's behavior), `text` validated.
  - `create === true` → validate `text` and `projectPath`; only a Browser-Lane
    `prepared` result yields a task; returns `taskId`.
- `GET /coo/dispatch/audit` unchanged (now also surfaces `taskId`).

## Tests (RED first)
- empty/whitespace text → 400 path + `dispatchCooRequest` throws, no audit row written.
- redaction: password / token / api-key / Bearer / key=value never appear in the
  persisted `requestText`; routing result still correct.
- browser + create → one task created, `status:"created"`, `taskId` returned, audit
  row linked to `taskId`.
- create requested for `approval_required` / `no_match` / `needs_input` → no task,
  `createTask` never called.
- prepare-only (no create) → still returns a `prepared` browser work item, no task.
- project label no longer "hive".

## Verification
`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` — all green.
