# COO Dispatch — Local/Offline Routing Capability — Design

> Date: 2026-06-25 · Status: approved (scope set by operator prompt) · Topic: coo-router-local-capability
> Builds on commit `eef08f9` (COO dispatch model tool + console surface).

## Problem

`coo_dispatch` is gated on the `browserbee` capability, so it's advertised only in
cloud-ok. But COO *routing* (resolve → prepare a plan) needs no network — only the
Browser-Lane *execution* (task creation/run) does. This slice makes COO routing a
first-class local capability available in every mode, while keeping Browser-Lane task
creation honestly gated on browser availability.

## Non-goals / guardrails

- Do **not** implement mail/message/desktop/terminal execution.
- No destructive Bee→Lane cleanup, `WorkerKind` flips, `DesktopBeeHelper.app` rename,
  or `src/lib/<x>bee/` module sweeps. Compatibility ids intact.
- **No silent downgrade** of browser-workflow execution to Desktop Lane — when Browser
  Lane is unavailable, dispatch reports it; it does not reroute.
- `POST /coo/dispatch` behavior in cloud-ok unchanged.

## Design

### 1. New connectivity capability `coo_router`
- Add `coo_router` to `CapabilityId` and the capability matrix — **available in all three
  modes** (cloud-ok, local-only, offline). Routing/preparation is local-only work.
- `coo_dispatch` is gated on `coo_router` (not `browserbee`), so it's advertised
  everywhere.

### 2. Honest execution gating (`src/lib/coo/dispatch.ts`)
- New status `"execution_unavailable"`.
- `dispatchCooTask` gains `browserAvailable?: boolean` (default `true`). When
  `create` is requested for a prepared Browser-Lane result but `browserAvailable` is
  false: **do not call `createTask`**, return `status: "execution_unavailable"` with a
  reason that says routing succeeded but Browser-Lane execution is waiting for
  connectivity, and update the audit row (status + reason) — no `taskId`.
- prepare-only (`dispatchCooRequest`) is unchanged and never checks connectivity, so it
  works in all modes.

### 3. Model tool availability (`src/lib/orchestrator/lane-tools.ts`)
- `availableLaneTools(local-only/offline)` now include `coo_dispatch` (via `coo_router`).
- `capabilityRoutingGuide` line for `coo_dispatch` makes the routing-vs-execution split
  explicit: it routes/prepares in every mode; `create=true` makes the Browser-Lane task
  only when browser execution is available, otherwise it reports the work is waiting.
- `formatCooDispatchResult` renders `execution_unavailable` so "routing worked" is
  clearly distinct from "execution unavailable".

### 4. Daemon (`src/daemon/server.ts`)
- `POST /coo/dispatch` create branch passes
  `browserAvailable = getConnectivityPolicy().getCapability("browserbee").available` to
  `dispatchCooTask`. prepare-only and resolve paths untouched.

### 5. Operator console
- Prepare always works (no change). The Create button stays gated to a browser-safe
  prepared result; clicking it when Browser Lane is unavailable yields an
  `execution_unavailable` result, which `renderCooResult` already shows as status +
  reason. No secrets rendered.

### 6. Posture copy (`src/lib/connectivity/posture.ts`)
- Add a `coo-router` posture entry — `works` in every mode — noting COO routing works
  locally while lane execution (e.g. Browser-Lane workflows) may queue/degrade/require
  approval.

## Tests (RED first)
- `coo_router` capability available in cloud-ok/local-only/offline (`policy.test.ts`).
- `availableLaneTools` includes `coo_dispatch` in all three modes; `capabilityRoutingGuide`
  (local/offline) includes it and mentions waiting/prepare (`lane-tools.test.ts` lists +
  new assertions).
- `dispatchCooTask` with `browserAvailable:false` → `execution_unavailable`, no
  `createTask` call, no `taskId`; audit reflects it (`dispatch.test.ts`).
- `formatCooDispatchResult(execution_unavailable)` distinguishes routing from execution
  (`lane-tools.coo.test.ts`).
- Posture: `coo-router` is `works` in every mode; updated offline count (`posture.test.ts`).

## Verification
`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` — all green.
