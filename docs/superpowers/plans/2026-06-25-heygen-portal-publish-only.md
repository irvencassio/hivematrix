# HeyGen Portal Publish-Only Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-heygen-portal-publish-only-design.md`. Builds on `f48fde1`.

## Task 1 — Publish-only helper [TDD]
- [x] RED: `src/lib/video/publish-draft.test.ts` (HOME-isolated, injected runVideoScript + fileExists) — portal_completed → publish.mjs (never make-avatar.mjs) + youtubeUrl + published; needs_publish_input refused (runner not called); already-published idempotent; missing video → missing_video; no secrets.
- [x] GREEN: extract `runPublish(run, draft)` shared internal in `src/lib/video/news-review.ts`; refactor `renderAndPublish` to use it; add `publishDraftVideo(id, deps?)` + typed `PublishDraftResult`.

## Task 2 — Endpoint + copy + cleanup + gates
- [x] `POST /video/publish-draft` in `src/daemon/server.ts` (map ok→200 / no_draft→404 / refusals→409).
- [x] `portalReviewCopy(portal_completed)` points to the publish-only action in `src/lib/video/portal-completion.ts`.
- [x] Tick checkboxes in `docs/superpowers/plans/2026-06-25-heygen-portal-completion.md`.
- [x] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs` green. Commit + push to `main`.
