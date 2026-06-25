# Operator Docs Lane Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Task 1: Lock Active Docs Copy

- [x] Add `scripts/operator-docs-lane-copy.test.mjs`.
- [x] Read the active operator docs:
  - `docs/USER-GUIDE.html`
  - `docs/BRINGUP-CHECKLIST.md`
  - `docs/RELEASE.md`
  - `docs/RUNBOOK-appliance-drills.md`
- [x] Assert they use lane names for visible headings/labels.
- [x] Assert they no longer contain known old public phrases such as `The Bees`, `Bees tab`, `DesktopBee helper`, `MessageBee`, and `MailBee`.
- [x] Run `npm test -- scripts/operator-docs-lane-copy.test.mjs` and confirm it fails before production changes.

## Task 2: Update Active Docs Copy

- [x] Update `docs/USER-GUIDE.html`.
- [x] Update `docs/BRINGUP-CHECKLIST.md`.
- [x] Update `docs/RELEASE.md`.
- [x] Update `docs/RUNBOOK-appliance-drills.md`.
- [x] Preserve route/config/tool identifiers and compatibility notes.
- [x] Run `npm test -- scripts/operator-docs-lane-copy.test.mjs` and confirm it passes.

## Task 3: Verify And Ship

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Commit and push to `main`.
