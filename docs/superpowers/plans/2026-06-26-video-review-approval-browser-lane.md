# Video Review Approval Uses Browser Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-26-video-review-approval-browser-lane-design.md`.

## Task 1 — RED: lock approval-to-portal behavior

- [x] Add `src/lib/video/news-review.test.ts`.
- [x] HOME/DB-isolate the test.
- [x] Seed a review draft and a fake review parent task.
- [x] Assert `resolveVideoDraft(id, "approve", deps)` calls a portal child creator,
      marks the draft `portal_pending`, updates the parent task, and never calls
      `make-avatar.mjs`.
- [x] Add a blocked-readiness test: no child task means the draft stays `review`
      and the parent task surfaces a Browser Lane readiness error.

## Task 2 — GREEN: portal creator in review approval

- [x] Add an injectable `ResolveVideoDraftDeps` / portal child creator hook in
      `src/lib/video/news-review.ts`.
- [x] Implement the real default creator using the existing
      `dispatchHeyGenVideoWorkflow`, `seedHeyGenBrowserSite`, `buildBrowserBeeTaskDescription`,
      `Task.create`, `markPortalTaskCreated`, and workflow-run linkage helpers.
- [x] Delete the legacy `renderConfig` / `renderAndPublish` approval path from this
      module; keep `runPublish` / `publishDraftVideo`.

## Task 3 — RED/GREEN: copy and UI surface

- [x] Update `src/lib/video/review.test.ts` for Browser Lane approval copy.
- [x] Update `src/lib/video/voice-turn.test.ts` so review approval routes through
      `resolveDraft` to a portal-task reply, not render/publish copy.
- [x] Add/adjust console source assertions that the review controls expose one
      Browser Lane approval button and no stale API-render copy.
- [x] Update `src/lib/video/review.ts`, `src/lib/video/voice-turn.ts`, and
      `src/daemon/console.ts`.

## Task 4 — Fix parent-task portal updates

- [x] Update `src/lib/video/portal-completion.ts` so parent-task updates use real
      columns only (`description`, `status`, `reviewState`, `error`).
- [x] Extend `src/lib/video/portal-completion.test.ts` to assert there is no
      `portalState` / `portalNote` update.

## Task 5 — Gates and commit

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Run `npm run verify:portal`.
- [ ] Commit and push to `main`.
