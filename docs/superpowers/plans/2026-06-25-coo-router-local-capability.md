# COO Router Local Capability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-coo-router-local-capability-design.md`. Builds on `eef08f9`.

## Task 1 — coo_router connectivity capability [TDD]
- [ ] RED: `policy.test.ts` asserts `coo_router` available in cloud-ok/local-only/offline.
- [ ] GREEN: add `coo_router` to `CapabilityId` + `CAPABILITY_MATRIX` (all three modes available) in `src/lib/connectivity/policy.ts`.

## Task 2 — Honest execution gating in dispatch [TDD]
- [ ] RED: `dispatch.test.ts` — `dispatchCooTask({browserAvailable:false})` on a browser route → `execution_unavailable`, no `createTask`, no `taskId`, audit updated; `browserAvailable:true` still creates.
- [ ] GREEN: add `"execution_unavailable"` status; `browserAvailable?` option; gate in `dispatchCooTask`; `updateCooDispatchAuditStatus(id, status, reason)` in `src/lib/coo/dispatch.ts`.

## Task 3 — Tool availability + copy + format [TDD]
- [ ] RED: `lane-tools.coo.test.ts` — `availableLaneTools(local/offline)` include `coo_dispatch`; `capabilityRoutingGuide(local/offline)` include it + mention wait/prepare; `formatCooDispatchResult(execution_unavailable)` distinguishes routing vs execution.
- [ ] GREEN: gate `coo_dispatch` on `coo_router`; reword routing line; handle `execution_unavailable` in `formatCooDispatchResult`. Update `lane-tools.test.ts` local/offline lists.

## Task 4 — Daemon + posture
- [ ] `POST /coo/dispatch` passes `browserAvailable` from the connectivity policy to `dispatchCooTask`.
- [ ] Add `coo-router` posture entry (works in all modes) in `src/lib/connectivity/posture.ts`; update `posture.test.ts` offline count.

## Task 5 — Process cleanup + gates + push
- [ ] Tick remaining checkboxes in `docs/superpowers/plans/2026-06-25-coo-dispatch-surface.md`.
- [ ] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs` green. Commit + push to `main`.
