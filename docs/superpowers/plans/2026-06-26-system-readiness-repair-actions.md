# System Readiness Repair Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-26-system-readiness-repair-actions-design.md`

## Task 1 — RED: repair tests

- [x] Extend `src/lib/system-readiness/index.test.ts` for advertised repair actions.
- [x] Add tests for `performSystemReadinessRepair("seed_coo_rules")`.
- [x] Add test that HeyGen repair preserves existing `google_sso`, provider account, and Google domains.
- [x] Add test that legacy video review repair rewrites old copy to Browser Lane wording and clears stale render error.

## Task 2 — GREEN: safe repair implementation

- [x] Add `SystemReadinessRepairAction` and `repairActions` to checks.
- [x] Implement `performSystemReadinessRepair`.
- [x] Harden `seedHeyGenBrowserSite()` to preserve existing auth metadata and union domains.
- [x] Ensure legacy review repair only updates active review/needs_input video-review tasks with safe script text.

## Task 3 — RED/GREEN: endpoint + console

- [x] Extend `scripts/system-readiness-endpoint.test.mjs` for `POST /system/readiness/repair` and action allowlist.
- [x] Extend `scripts/system-readiness-console.test.mjs` for repair buttons and no "repair all".
- [x] Wire endpoint in `src/daemon/server.ts`.
- [x] Render repair buttons in `src/daemon/console.ts`.

## Task 4 — Verify and ship

- [x] Focused tests.
- [x] `npm run typecheck`.
- [x] `npm test`.
- [x] `node scripts/scope-wall.mjs`.
- [x] `npm run verify:portal`.
- [ ] Commit and push to `main`.
