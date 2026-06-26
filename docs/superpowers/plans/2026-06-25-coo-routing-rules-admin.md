# COO Routing Rules Admin Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-coo-routing-rules-admin-design.md`. Approved direction: Option B, structured COO routing-rules editor inside the existing Lanes settings tab.

## Task 1: Console Source Test [TDD]

- [x] RED: Add `scripts/coo-routing-rules-console.test.mjs`.
- [x] Assert the Lanes settings source exposes a "COO routing rules" section.
- [x] Assert the source calls existing endpoints only:
  - `GET /coo/routing-rules`
  - `POST /coo/routing-rules`
  - `DELETE /coo/routing-rules/:id`
  - `GET /coo/routing-rules/:id/history`
  - `POST /coo/routing-rules/seed`
  - `POST /coo/routing-rules/resolve`
- [x] Assert controls exist for lane, policy, model posture, risk tier, enabled, priority, match arrays, policy JSON, save, duplicate, delete, history, and resolve tester.
- [x] Assert the visible/source segment does not expose secret-entry fields (`password`, `cookie`, `credentialRef`, `.secret`).
- [x] Run `npm test -- scripts/coo-routing-rules-console.test.mjs` and confirm it fails.

## Task 2: Console UI Implementation

- [x] GREEN: Add the COO routing rules section to `src/daemon/console.ts` immediately after COO Dispatch and before Browser Lane readiness.
- [x] Add empty containers/controls:
  - `coo_rules_lane_filter`
  - `coo_rules_list`
  - `coo_rules_result`
  - `coo_resolve_text`
  - `coo_resolve_domains`
  - `coo_resolve_result`
- [x] Update the Lanes tab activation to call `renderCooRoutingRules()`.
- [x] Implement `renderCooRoutingRules()`:
  - Fetch `/coo/routing-rules`.
  - Apply optional lane filter client-side.
  - Render summary counts.
  - Render compact editable cards sorted in API order.
- [x] Implement `cooRuleEditor(rule, index)` with structured controls:
  - Basic fields: id (read-only), name, priority, enabled, intent.
  - Route fields: lane, capability, backendPolicy, modelPosture, riskTier.
  - Match arrays: phrases, domains, projects, workflows, tags.
  - JSON object fields: constraints, approvalPolicy, verificationPolicy.
  - notes.
- [x] Implement helpers:
  - `cooRuleFieldId(index, field)`
  - `cooParseList(value)`
  - `cooParseObject(value, label)`
  - `cooSecretLike(value)`
  - `cooCollectRule(index, existingId)`
- [x] Implement actions:
  - `cooNewRule()`
  - `cooSaveRule(index, existingId)`
  - `cooDuplicateRule(index)`
  - `cooDeleteRule(id)`
  - `cooShowRuleHistory(id)`
  - `cooSeedDefaultRules()`
  - `cooResolveRuleTest()`
- [x] Keep update/delete errors visible in `coo_rules_result`.
- [x] Run `npm test -- scripts/coo-routing-rules-console.test.mjs` and confirm it passes.

## Task 3: Review And Verification

- [x] Review the diff for scope drift and secret exposure.
- [x] Run `npm test -- scripts/coo-dispatch-console.test.mjs scripts/coo-routing-rules-console.test.mjs`.
- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Update this plan's checkboxes as work completes.

## Notes

- No backend route changes are planned because the existing daemon API already covers this surface.
- No local-model files are touched; `npx tsx scripts/qwen-readiness.mts` is not required.
