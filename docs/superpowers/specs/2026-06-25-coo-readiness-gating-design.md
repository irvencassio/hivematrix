# COO Dispatch — Browser Lane Readiness Gating + Briefing — Design

> Date: 2026-06-25 · Status: approved (scope set by operator prompt) · Topic: coo-readiness-gating
> Builds on commit `dbeca97` (COO routing as a local capability + honest execution gating).

## Problem

COO dispatch can route + create a Browser Lane task, gated on browser *execution*
availability. It does not yet consider whether the **target site's auth/readiness**
is good. We connect Browser Lane site/auth readiness to dispatch (warn on prepare,
hold on create) and surface attention items in the morning briefing.

## Non-goals / guardrails

- No mail/message/desktop/terminal execution. No destructive Bee→Lane cleanup,
  `WorkerKind` flips, `DesktopBeeHelper.app` rename, or module sweeps.
- **No secrets** ever exposed — only non-secret `credentialRef` *pointers*, site id/name,
  color/status, and `traceRunId`. Never credential values, cookies, or Keychain material.
- No silent reroute; routing success, execution availability, and site readiness are
  reported as three distinct concerns.

## Design

### 1. Readiness match helper (`src/lib/browser-lane/store.ts`)
- `matchBrowserSiteReadiness(domains: string[]): BrowserSiteReadinessMatch` — reuses
  `getBrowserLaneReadinessDashboard`, matches a domain (host or subdomain) against each
  site's `allowedDomains`, and returns `{ matched, siteId, siteName, color, status,
  credentialRef, traceRunId }` (metadata only). No match → `matched:false`, nulls.

### 2. Readiness on the dispatch result (`src/lib/coo/dispatch.ts`)
- New `CooDispatchReadiness` field on `CooDispatchResult` (browser routes only):
  `{ matched, siteId, siteName, color, status, credentialRef, traceRunId, requiresLogin,
  acceptable, warning }`.
- **Acceptable = matched && color === "green"** (status "ready"). orange/red/yellow/gray
  and no-run all hold. For a **no match**: acceptable iff the route is *not* authenticated
  (`requiresLogin === false`) — an authenticated workflow route with no configured site is
  NOT assumed safe.
- `dispatchCooRequest` (prepare) attaches `readiness` and stays `prepared` (warnings, not a
  block).
- `dispatchCooTask` (create) gate order: `browserAvailable` first (→ `execution_unavailable`,
  unchanged), then readiness. New status **`readiness_required`**: when readiness is not
  acceptable, do not call `createTask`; return `readiness_required` with a clear,
  secret-free reason; audit updated.

### 3. Model + console surfacing (`lane-tools.ts`, `console.ts`)
- `formatCooDispatchResult`: render a readiness line (site, color/status, traceRunId) and a
  `readiness_required` branch that says routing succeeded but site/auth readiness needs
  attention — distinct from execution-unavailable.
- Console: show the matched site's readiness beside the prepared result; the **Create**
  button stays hidden unless `status === "prepared" && lane === "browser" &&
  (readiness == null || readiness.acceptable)`.

### 4. Morning briefing (`src/lib/voice/briefing.ts`, `command-turn.ts`)
- `buildVoiceBriefing` gains an optional `browserReadiness` input and renders a compact
  line: count needing attention (red + orange + gray/unknown) and the top sites
  (`name (status)`), with `siteId`/`traceRunId` where useful. No secrets.
- `composeBriefing` gathers it from `getBrowserLaneReadinessDashboard` (injectable dep,
  default real).

### 5. Daemon
- `POST /coo/dispatch` create path already routes through `dispatchCooTask`; readiness
  gating rides along. prepare path now returns `readiness` in the result. No new route.

## Behavior change (intended)
Create for an **authenticated** browser route (capability `workflow.run`, `requiresLogin`)
now requires a configured, **green** site. Existing create-success tests therefore seed a
ready site; that reflects the new honest gating.

## Tests (RED first)
- `matchBrowserSiteReadiness`: matches by domain/subdomain; no-match returns nulls; no secrets.
- prepare returns `readiness` metadata/warnings for a matched site.
- create with a green site → `created`; with `needs_reauth` (orange) → `readiness_required`,
  no task; with unknown/no-run (gray) → `readiness_required`; no matching site for an
  authenticated route → `readiness_required`; non-auth route + no site → allowed.
- `execution_unavailable` still precedes readiness (browser off).
- `formatCooDispatchResult(readiness_required)` distinguishes routing/exec/readiness.
- console renders readiness + gates Create on it.
- `buildVoiceBriefing` renders a Browser Lane readiness attention line; `composeBriefing`
  wires it.

## Verification
`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` — all green.
