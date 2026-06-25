# COO Dispatch Hardening + Task Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-coo-dispatch-task-creation-design.md`. Builds on `19ed2c4`.

## Task 1 — Audit taskId migration (additive)
- [ ] RED: assert `coo_dispatch_audit` has a `taskId` column in `src/lib/db/browser-lane-schema.test.ts`.
- [ ] GREEN: append migration **v20** `ALTER TABLE coo_dispatch_audit ADD COLUMN taskId TEXT;` to `MIGRATIONS` (do NOT edit v19).

## Task 2 — Dispatch hardening (validation + redaction) [TDD]
- [ ] RED in `src/lib/coo/dispatch.test.ts`: empty/whitespace text throws `CooDispatchValidationError` and writes no audit row; secret patterns (password/token/api-key/Bearer/key=value) are redacted from persisted `requestText`; routing still resolves on original text.
- [ ] GREEN in `src/lib/coo/dispatch.ts`: `CooDispatchValidationError`; guard at top of `dispatchCooRequest`; `redactSecrets()` applied to `requestText` + context at persist time; remove `"hive"` fallback → `DEFAULT_TASK_PROJECT`; add optional `options.projectPath`.

## Task 3 — Explicit task creation [TDD]
- [ ] RED: browser+create → `createTask` called once, `status:"created"`, `taskId` set, audit linked; approval_required/no_match/needs_input + create → `createTask` NOT called, no task.
- [ ] GREEN: `dispatchCooTask(request, { create, projectPath, createTask })`; `CooTaskCreator` type; `updateCooDispatchAuditTask`; add `taskId` to `CooDispatchResult` + audit entry/select.

## Task 4 — Daemon endpoint
- [ ] `POST /coo/dispatch`: `create` flag + `projectPath` validation via `normalizeHomeProjectPath` (400 on empty text / invalid path, no audit); real `createTask` reusing the Browser-Lane `Task.create` pattern + `buildBrowserBeeTaskDescription`. Leave resolve + prepare-only path intact.

## Task 5 — Gates + push
- [ ] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs` all green. Commit + push to `main`.
