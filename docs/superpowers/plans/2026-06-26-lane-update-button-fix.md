# Lane "Update" button fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Checkbox tracking below.

Design: `docs/superpowers/specs/2026-06-26-lane-update-button-fix-design.md`

## Task 1 — RED: console tests

- [ ] In `src/daemon/console.test.ts`, extract `laneActionCall` and assert:
  `laneActionCall("terminal-lane","update")` → `laneAppAction('terminal-lane','install')`;
  `repair` → `laneRepairApplications`; `run_readiness` → `laneRunReadiness`;
  `open` → `launch`.
- [ ] Source assertions: `.lane-primary` + `.lane-primary.update` CSS present;
  `renderLaneSetup` uses `lane-primary` for the primary + the `update` modifier
  for update/install/repair; banner button uses `lane-primary`.
- [ ] Run → fail.

## Task 2 — GREEN

- [ ] `laneActionCall`: map `"update"` → `"install"`.
- [ ] Add `.lane-primary` + `.lane-primary.update` CSS.
- [ ] `renderLaneSetup`: primary uses `lane-primary` (+ `update` when
  install/update/repair); banner "Update Lane Apps" uses `lane-primary update`.
- [ ] Run → green.

## Task 3 — Gates + commit/push

- [ ] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.
- [ ] Commit; push to main.
