# HeyGen Portal Pipeline Dry-Run Verification + Runbook — Design

> Date: 2026-06-25 · Status: approved (scope set by operator prompt) · Topic: heygen-portal-pipeline-verification
> Builds on commit `59a5c7e` (portal operator console + voice controls).

## Problem

The HeyGen portal pipeline (draft → portal task → completion → publish-only) spans
several helpers + endpoints. There's no single command that exercises the whole flow
and fails loudly if wiring breaks — and doing so must never touch real HeyGen or
YouTube. We add a dry-run verification harness + an operator runbook.

## Non-goals / guardrails

- No browser clicking / credential injection / Playwright. No mail/message/desktop/
  terminal execution. No destructive Bee→Lane cleanup, `WorkerKind` flips,
  `DesktopBeeHelper.app` rename, or module sweeps.
- The harness performs **no real external side effects** by default: every external
  runner (HeyGen render, YouTube upload) is an injected fake; readiness is seeded
  in-memory; drafts + DB live under a temp HOME / temp `HIVEMATRIX_DB_PATH`.
- No secrets in logs, docs, or verification output.

## Design

### 1. Harness lib (`src/lib/video/verify-portal-pipeline.ts`)
`runHeyGenPortalDryRun(deps?)` exercises the real pipeline helpers with fakes and
returns a structured, secret-free `PortalDryRunReport { ok, dryRun:true, phases[],
evidence:{ publishArgs }, summary }`. Phases (each isolated, a throw → that phase
`ok:false` with a clear detail):
1. **seed** — `seedHeyGenBrowserSite()`; assert site + probe + routing rule exist.
2. **draft** — `saveDraft` a review draft with a clean script; assert it round-trips.
3. **readiness gate** — `dispatchHeyGenVideoWorkflow(create:true)` with no readiness run
   → expect `readiness_required`; `persistTask` throws if called (proves no task created).
4. **portal task created** — record a green+fresh readiness run, dispatch again with a
   fake `persistTask` → `created`; `markPortalTaskCreated` → draft `portal_pending`.
5. **portal completion** — `applyHeyGenPortalCompletion` with a fake local MP4
   (`fileExists:()=>true`) → draft `portal_completed`, `paths.video` set.
6. **publish-only (dry-run)** — `publishDraftVideo` with an injected `runVideoScript`
   that records args and returns a fake URL → `published`; `evidence.publishArgs` MUST
   include `publish.mjs` and MUST NOT include `make-avatar.mjs` (no re-render, no upload).
7. **needs_publish_input refusal** — a `needs_publish_input` draft → `publishDraftVideo`
   refuses (`code:"needs_publish_input"`), runner NOT called.
8. **endpoint wiring** — `deps.serverSource()` (default reads `src/daemon/server.ts`)
   declares `/video/heygen-workflow`, `/video/portal-complete`, `/video/publish-draft`,
   `/video/drafts`. Injecting a broken source fails this phase loudly.

### 2. CLI (`scripts/verify-heygen-portal-pipeline.mjs`)
Sets a temp HOME + temp `HIVEMATRIX_DB_PATH` (scratch — never real data), runs the
harness, prints `✓/✗ phase — detail` + summary, cleans up, exits 0/1. Wired as
`npm run verify:portal`.

### 3. Tests (`src/lib/video/verify-portal-pipeline.test.ts`, HOME+DB isolated)
- All phases pass; report covers every phase; `evidence.publishArgs` has `publish.mjs`,
  not `make-avatar.mjs` (dry-run never uploads/renders).
- A broken `serverSource` → `report.ok:false` with a clear endpoint-wiring failure
  (proves it fails loudly).
- No secrets in the report.

### 4. Runbook (`docs/runbooks/heygen-portal-video-pipeline.md`)
Operator steps: prerequisites, readiness check, create portal task, record completion,
publish to YouTube, `needs_publish_input` handling, troubleshooting
(`readiness_required` / `portal_pending` / `missing_video`). Lane naming. No secrets.

### 5. Console link (lightweight)
The HeyGen portal panel gets a muted one-line pointer to the runbook path (no new help
system).

## Verification
`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` · `npm run verify:portal` — all green.
