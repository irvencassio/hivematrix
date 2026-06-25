# COO Readiness Gating + Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-coo-readiness-gating-design.md`. Builds on `dbeca97`.

## Task 1 — Readiness match helper [TDD]
- [x] RED: `src/lib/browser-lane/store.test.ts` — `matchBrowserSiteReadiness(["app.heygen.com"])` matches a seeded site (color/status/credentialRef/traceRunId, no secrets); unmatched domain → `matched:false`.
- [x] GREEN: add `BrowserSiteReadinessMatch` + `matchBrowserSiteReadiness` to `src/lib/browser-lane/store.ts` (reuse `getBrowserLaneReadinessDashboard`).

## Task 2 — Readiness on dispatch result + create gating [TDD]
- [x] RED: `src/lib/coo/dispatch.test.ts` — prepare attaches `readiness`; create green→`created`; needs_reauth→`readiness_required` (no task); unknown/no-run→`readiness_required`; no-site authenticated→`readiness_required`; non-auth+no-site→allowed; `execution_unavailable` precedes readiness. Update existing create-success tests to seed a green site.
- [x] GREEN: `CooDispatchReadiness` + `readiness` field; compute in `dispatchCooRequest`; `readiness_required` status; gate in `dispatchCooTask` after `browserAvailable`.

## Task 3 — Model + console surfacing [TDD]
- [x] RED: `lane-tools.coo.test.ts` — `formatCooDispatchResult(readiness_required)` + readiness line; `scripts/coo-dispatch-console.test.mjs` — readiness shown + Create gated on `readiness.acceptable`.
- [x] GREEN: `formatCooDispatchResult` readiness rendering; `console.ts` readiness display + Create gate.

## Task 4 — Morning briefing [TDD]
- [x] RED: `src/lib/voice/briefing.test.ts` — `buildVoiceBriefing({browserReadiness})` renders an attention line (counts + top sites, no secrets); none → reassuring line.
- [x] GREEN: `browserReadiness` input + render in `buildVoiceBriefing`; wire `composeBriefing` to gather from the dashboard (injectable dep).

## Task 5 — Cleanup + gates + push
- [x] Tick remaining checkboxes in `docs/superpowers/plans/2026-06-25-coo-router-local-capability.md`.
- [x] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs` green. Commit + push to `main`.
