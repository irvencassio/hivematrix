# Onboarding Lane Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Task 1: Lock Readiness Checklist Copy

- [x] Update `src/lib/onboarding/onboarding.test.ts`.
- [x] Add assertions that optional setup step titles are `Desktop Lane`, `Message Lane`, and `Mail Lane`.
- [x] Assert those default details/remediations do not contain `DesktopBee`, `MessageBee`, or `MailBee`.
- [x] Run `npm test -- src/lib/onboarding/onboarding.test.ts` and confirm it fails before production changes.

## Task 2: Lock Guided Message Setup Copy

- [x] Update `src/lib/onboarding/messagebee-action.test.ts`.
- [x] Assert `configureMessageBee` detail does not contain `MessageBee`.
- [x] Run `npm test -- src/lib/onboarding/messagebee-action.test.ts` and confirm it fails before production changes.

## Task 3: Update Production Onboarding Copy

- [x] Update `src/lib/onboarding/onboarding.ts`.
- [x] Change Desktop/Message/Mail step titles, defaults, and remediations to lane language.
- [x] Update comments where they describe active operator-facing lanes.
- [x] Update `src/lib/onboarding/actions.ts` result details and active comments to lane language.
- [x] Keep `DesktopBeeHelper.app`, `DESKTOPBEE_PORT`, and launchd labels unchanged.
- [x] Run focused onboarding tests and confirm they pass.

## Task 4: Verify And Ship

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Commit and push to `main`.
