# Desktop Lane Contract Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Task 1: Lock Default Title Copy

- [x] Update `src/lib/desktopbee/contracts.test.ts`.
- [x] In `parseDesktopBeeJobCreate normalizes defaults from app scope and risk posture`, expect the default title to start with `Desktop Lane:`.
- [x] Also assert the default title does not match `/DesktopBee/`.
- [x] Run `npm test -- src/lib/desktopbee/contracts.test.ts` and confirm the test fails before production changes.

## Task 2: Lock Generated Description Copy

- [x] Update `src/lib/desktopbee/contracts.test.ts`.
- [x] Rename the description test to mention Desktop Lane.
- [x] Use an explicit title such as `Desktop Lane Messages triage`.
- [x] Assert the description contains `This task came from Desktop Lane`.
- [x] Assert the description contains `Browser Lane workflow`.
- [x] Assert the description does not match `/DesktopBee|BrowserBee/`.
- [x] Run `npm test -- src/lib/desktopbee/contracts.test.ts` and confirm the test still fails before production changes.

## Task 3: Update Production Contract Copy

- [x] Update `src/lib/desktopbee/contracts.ts`.
- [x] Change default title prefix to `Desktop Lane:`.
- [x] Change generated task description intro to `This task came from Desktop Lane.`
- [x] Change reroute guidance to `Browser Lane workflow`.
- [x] Keep `desktopbeeRequest`, `createdVia: "desktopbee.jobs"`, and `bee: "desktopbee"` unchanged.
- [x] Run `npm test -- src/lib/desktopbee/contracts.test.ts` and confirm the focused test passes.

## Task 4: Verify And Ship

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Commit and push to `main`.
