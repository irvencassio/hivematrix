# HeyGen Portal Operator Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-heygen-portal-operator-controls-design.md`. Builds on `709ead5`.

## Task 1 — Voice status-aware portal handling [TDD]
- [ ] RED: `src/lib/video/voice-turn.test.ts` — portal_completed + "publish the video" → injected publishDraft called + URL spoken; needs_publish_input → refused, publishDraft NOT called; portal_pending → "still running"; no-draft read unchanged; no secrets.
- [ ] GREEN: status-aware routing + injectable `latestDraft`/`publishDraft`/`resolveDraft` in `src/lib/video/voice-turn.ts`.

## Task 2 — Console HeyGen portal panel [TDD source test]
- [ ] RED: `scripts/heygen-portal-console.test.mjs` — Publish-to-YouTube button + `/video/publish-draft`; portal completion form + `/video/portal-complete`; create-portal-task + `/video/heygen-workflow`; portal states shown; no "avatar render"/"~$0.05" in the portal panel; no secret fields.
- [ ] GREEN: portal panel + `renderPortalVideos`/`publishPortalDraft`/`submitPortalCompletion`/`createPortalTask` JS in `src/daemon/console.ts`, mounted in the Lanes settings tab.

## Task 3 — Cleanup + gates + push
- [ ] Tick checkboxes in `docs/superpowers/plans/2026-06-25-heygen-portal-publish-only.md`.
- [ ] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs` green. Commit + push to `main`.
