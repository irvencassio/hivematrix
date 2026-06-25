# HeyGen Browser Lane Workflow Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-heygen-browser-lane-workflow-design.md`. Builds on `e2b8e7d`.

## Task 1 — Seed + job builder [TDD]
- [ ] RED: `src/lib/browser-lane/heygen.test.ts` — `seedHeyGenBrowserSite` creates metadata-only site/probe/rule (no secret columns); `buildHeyGenVideoJob` → requiresLogin true, all six handoff points (login/2fa/captcha/file-picker/preview/export), script carried, no secrets in payload; `resolveCooRouteFromRules` routes `app.heygen.com` → browser.
- [ ] GREEN: `src/lib/browser-lane/heygen.ts` — `HEYGEN_SITE`, `HEYGEN_HANDOFF_POINTS`, `seedHeyGenBrowserSite()`, `buildHeyGenVideoJob()`.

## Task 2 — Readiness-gated dispatch [TDD]
- [ ] RED: `src/lib/video/heygen-workflow.test.ts` — green+fresh → `created` + taskId + rich envelope (requiresLogin, no secrets); needs_reauth → `readiness_required` (no create, persistTask not called); stale green → `readiness_required`; prepare returns readiness + job.
- [ ] GREEN: `src/lib/video/heygen-workflow.ts` — `dispatchHeyGenVideoWorkflow(input, opts)` over `dispatchCooRequest`/`dispatchCooTask` with injected `persistTask` building the HeyGen envelope.

## Task 3 — Endpoint + cleanup + gates
- [ ] `POST /video/heygen-workflow` in `src/daemon/server.ts` (validate script/title; create validates projectPath, passes browserAvailable + staleAfterHours + real persistTask).
- [ ] Tick checkboxes in `docs/superpowers/plans/2026-06-25-agent-browser-snapshot-mvp.md`.
- [ ] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs` green. Commit + push to `main`.
