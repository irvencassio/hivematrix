# COO Route-to-Execution Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-coo-dispatch-bridge-design.md`. Builds on `e5c4325`.

## Task 1 — Audit table migration
- [ ] Append a new migration string to `MIGRATIONS` in `src/lib/db/index.ts` (do NOT edit existing entries):
  `coo_dispatch_audit(_id, requestText, requestContext, ruleId, ruleName, lane, capability, status, workItemId, reason, createdAt)` + index on `createdAt`.
- [ ] Add column-existence assertion to `src/lib/db/browser-lane-schema.test.ts` (or a new schema test) — RED first.

## Task 2 — Dispatch module (TDD)
- [ ] RED: `src/lib/coo/dispatch.test.ts` covering: browser→prepared, no_match, disabled-rule→no_match, legacy `browserbee`→`browser`, approval-required lanes, risk escalation, audit persisted (no secret fields).
- [ ] GREEN: `src/lib/coo/dispatch.ts`:
  - `dispatchCooRequest(request)` → resolve via `resolveCooRouteFromRules`, branch on `LANE_DISPATCH_POLICY` + `riskTier`.
  - Browser path builds work item via `parseBrowserBeeJobCreate` + `buildBrowserBeeTaskRequestEnvelope` (pure).
  - `needs_input` when no startUrl derivable.
  - Audit helpers: `recordCooDispatchAudit`, `listCooDispatchAudit` (rowid DESC tiebreak), `getCooDispatchAudit`.

## Task 3 — Daemon endpoints
- [ ] `POST /coo/dispatch` and `GET /coo/dispatch/audit` in `src/daemon/server.ts`, matching existing `/coo/*` route style. Leave `POST /coo/routing-rules/resolve` untouched.

## Task 4 — Gates
- [ ] `npm run typecheck` (0 errors), `npm test` (all pass), `node scripts/scope-wall.mjs` (0 violations).
- [ ] Commit and push to `main`.
