# Browser Lane Readiness Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-browser-lane-readiness-maintenance-design.md`. Builds on `262fd04`.

## Task 1 — Staleness in dashboard + match [TDD]
- [x] RED: `store.test.ts` — dashboard `readiness.stale`/`ageMs`/`lastRunAt` + `totals.stale`; `matchBrowserSiteReadiness` stale fields (backdate a run via SQL).
- [x] GREEN: thread `staleAfterHours`/`now` into `getBrowserLaneReadinessDashboard` + `matchBrowserSiteReadiness` in `src/lib/browser-lane/store.ts`.

## Task 2 — COO stale gating [TDD]
- [x] RED: `dispatch.test.ts` — stale authenticated green site → `readiness_required`; fresh green → `created`; stale + non-auth route → allowed.
- [x] GREEN: add `stale`/`lastRunAt`/`ageMs` to `CooDispatchReadiness`; `staleAfterHours` option; stale-aware `evaluateReadiness` in `src/lib/coo/dispatch.ts`.

## Task 3 — Maintenance config + scheduler [TDD]
- [x] RED: `readiness-schedule.test.ts` — parse/clamp config; `readinessSweepDue` due/not-due; `runReadinessSweepNow` stamps `lastRunAt` + handles no-sites (injected runner).
- [x] GREEN: `src/lib/browser-lane/readiness-schedule.ts` — config + due + `runReadinessSweepNow` + `startBrowserLaneReadinessLoop`.

## Task 4 — Endpoints + daemon + console [TDD]
- [x] RED: `coo-dispatch-console.test.mjs` (or new console source test) — Browser Lane readiness block + Run button + stale display.
- [x] GREEN: `GET/POST /settings/browser-lane-readiness`, `POST /browser-lane/readiness/run`, dashboard passes `staleAfterHours`, `/coo/dispatch` passes it; start the loop in `src/daemon/index.ts`; console readiness block.

## Task 5 — Briefing + cleanup + gates [TDD]
- [x] RED: `briefing.test.ts` — stale/recently-refreshed line + attention items, no secrets.
- [x] GREEN: `staleCount`+`lastSweepAt` in `BriefingBrowserReadiness` + render; wire `composeBriefing`.
- [x] Tick checkboxes in `docs/superpowers/plans/2026-06-25-coo-readiness-gating.md`.
- [x] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs` green. Commit + push to `main`.
