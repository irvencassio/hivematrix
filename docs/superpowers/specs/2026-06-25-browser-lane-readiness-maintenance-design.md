# Browser Lane Readiness Maintenance — Design

> Date: 2026-06-25 · Status: approved (scope set by operator prompt) · Topic: browser-lane-readiness-maintenance
> Builds on commit `262fd04` (COO dispatch readiness gating + briefing).

## Problem

COO dispatch now gates Browser Lane task creation on site readiness, but readiness
is only refreshed when someone runs a probe. Stale readiness can let a task through
on out-of-date auth state. We add: readiness **staleness** (configurable, default
24h), a **scheduled sweep** + **run-now** control, stale-aware COO gating, and
briefing coverage — so COO has fresh state to rely on.

## Non-goals / guardrails

- No mail/message/desktop/terminal execution. No destructive Bee→Lane cleanup,
  `WorkerKind` flips, `DesktopBeeHelper.app` rename, or module sweeps.
- **No secrets** logged or surfaced — only counts, status/color, site id/name,
  `traceRunId`, timestamps.
- The briefing reads stored state only; it never performs a browser run.
- The sweep records honest statuses (no-site, no-backend, human-required, CAPTCHA,
  2FA, failure) — it reuses the existing `runBrowserLaneReadiness` which already does.

## Design

### 1. Staleness (`src/lib/browser-lane/store.ts`)
- `getBrowserLaneReadinessDashboard({ siteId?, staleAfterHours = 24, now? })` adds per-site
  `readiness.stale` (no run, or latest run older than threshold), `readiness.ageMs`,
  `readiness.lastRunAt`, and `totals.stale`.
- `matchBrowserSiteReadiness(domains, { staleAfterHours = 24, now? })` returns `stale`,
  `lastRunAt`, `ageMs` (computed via the dashboard, single source).

### 2. COO stale gating (`src/lib/coo/dispatch.ts`)
- `CooDispatchReadiness` gains `stale`, `lastRunAt`, `ageMs`.
- Acceptability: matched green & **not stale** → acceptable; **green but stale** holds for an
  authenticated route (`requiresLogin`) and is fine for non-auth; non-green holds; no-match
  holds only for authenticated routes (unchanged). Stale authenticated → `readiness_required`.
- `staleAfterHours` is a dispatch option (default 24); the daemon passes the configured value.

### 3. Maintenance config + scheduler (`src/lib/browser-lane/readiness-schedule.ts`, new)
- Config `browserLaneReadiness: { enabled: false, hour: 7, staleAfterHours: 24, lastRunAt? }`
  with `parse/get/set` (mirrors morning-briefing).
- `readinessSweepDue(config, now)` — once per day at `hour` (mirrors `briefingDue`).
- `runReadinessSweepNow(deps)` — calls `runBrowserLaneReadiness({ siteId: "all" })`, stamps
  `lastRunAt`, returns a secret-free summary (`ok`, counts by color, runs). Injectable.
- `startBrowserLaneReadinessLoop(deps, intervalMs)` — idempotent daemon loop (mirrors
  `startMorningBriefingLoop`); self-gates on config; skips offline.

### 4. Endpoints + console (`src/daemon/server.ts`, `console.ts`)
- `GET/POST /settings/browser-lane-readiness` — read/update config.
- `POST /browser-lane/readiness/run` — body `{ siteId? }`, runs all/one site via
  `runReadinessSweepNow`, returns run/trace summaries (no secrets).
- `GET /browser-lane/dashboard` passes the configured `staleAfterHours`.
- `/coo/dispatch` create passes `staleAfterHours`.
- Console Lanes tab: a compact Browser Lane readiness block — dashboard counts, stale
  state, a **Run readiness check** button. No decorative rebuild.

### 5. Briefing (`src/lib/voice/briefing.ts`, `command-turn.ts`)
- `BriefingBrowserReadiness` gains `staleCount` + `lastSweepAt`. The line reports whether
  readiness was recently refreshed or is stale, plus top attention sites. `composeBriefing`
  reads the dashboard + config `lastRunAt` (no browser run).

### 6. Daemon (`src/daemon/index.ts`)
- Start `startBrowserLaneReadinessLoop()` alongside the morning-briefing loop.

## Tests (RED first)
- dashboard `stale` true for old/no run, false for fresh; `totals.stale`.
- `matchBrowserSiteReadiness` stale fields.
- COO create: stale authenticated green site → `readiness_required`; fresh green → `created`;
  stale + non-auth → allowed.
- `readinessSweepDue` due/not-due; `runReadinessSweepNow` stamps `lastRunAt`, handles no-sites.
- `POST /browser-lane/readiness/run` (via the sweep runner) returns summaries.
- console source: readiness block + Run button + stale display.
- briefing text: stale/refreshed + attention items, no secrets.

## Verification
`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` — all green.
