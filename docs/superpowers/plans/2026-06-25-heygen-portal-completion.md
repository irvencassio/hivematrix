# HeyGen Portal Child-Task Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-heygen-portal-completion-design.md`. Builds on `f028625`.

## Task 1 — Draft state extension
- [ ] Add `portal_pending`/`portal_completed`/`needs_publish_input` statuses + optional fields (`portalTaskId`, `portalResolvedTaskId`, `portalVideoUrl`, `portalCompletedAt`, `manualCompletionNote`) to `src/lib/video/draft-store.ts`. (Type-only; existing tests stay green.)

## Task 2 — Completion contract + resolver [TDD]
- [ ] RED: `src/lib/video/portal-completion.test.ts` (HOME-isolated) — normalizer requires parentDraftId + rejects secrets; resolver: local→portal_completed+paths.video; url/note→needs_publish_input (no youtubeUrl); duplicate→idempotent; failed/cancelled→review recoverable + portalTaskId cleared; missing draft→fail; copy has linkage, no secrets; markPortalTaskCreated→portal_pending; portalChildPending dup guard.
- [ ] GREEN: `src/lib/video/portal-completion.ts` — `normalizeHeyGenPortalCompletion`, `applyHeyGenPortalCompletion`, `markPortalTaskCreated`, `portalChildPending`, `portalReviewCopy` (injectable fileExists + task-update deps).

## Task 3 — Daemon wiring + cleanup + gates
- [ ] `POST /video/heygen-workflow` accepts `parentDraftId` (dup guard + `markPortalTaskCreated` + `output.heygen.parentDraftId`); add `POST /video/portal-complete`.
- [ ] Tick checkboxes in `docs/superpowers/plans/2026-06-25-heygen-browser-lane-workflow.md`.
- [ ] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs` green. Commit + push to `main`.
