# W3.2 Posture Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Task 1: Add Failing Contract Tests

- [x] Create `src/lib/connectivity/posture.test.ts`.
- [x] Assert `cloud-ok` is all `works`.
- [x] Assert `offline` has local Qwen, DesktopBee, and TermBee as `works`.
- [x] Assert image is `degraded` under local-only/offline.
- [x] Assert cloud-needing lanes are `queued`.
- [x] Assert all-mode report exposes `cloud-ok`, `local-only`, and `offline`.

## Task 2: Implement Pure Posture Report

- [x] Create `src/lib/connectivity/posture.ts`.
- [x] Export `describeLocalPosture(mode)`.
- [x] Export `describeAllPostures(currentMode)`.
- [x] Include labels, dispositions, actions, notes, counts, and summary.

## Task 3: Expose API

- [x] Add `GET /posture` to `src/daemon/server.ts`.
- [x] Embed `posture` in `GET /connectivity` for console and mobile clients.

## Task 4: Render In Console

- [x] Update `src/daemon/console.ts`.
- [x] Render the current posture summary and capability rows in the
  Connectivity panel.

## Task 5: Verify

- [x] `npm run typecheck`
- [x] Focused connectivity/posture tests
- [x] `npm test`
- [x] `node scripts/scope-wall.mjs`
