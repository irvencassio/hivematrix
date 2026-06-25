# Decisions Browser Lane Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Task 1: Lock Decisions Browser Lane Copy

- [x] Add `scripts/decisions-browser-lane-copy.test.mjs`.
- [x] Assert `DECISIONS.md` contains Browser Lane, Desktop Lane, Message Lane, Mail Lane, Review Lane, and Memory Lane wording.
- [x] Assert `DECISIONS.md` does not contain `BrowserBee`, `WebBee`, `Weaver`, `Bee lanes`, or `Bees view`.
- [x] Assert lower-case compatibility strings `/browserbee/health`, `browserbee.desktopFallback`, and `webbee_search/browserbee_run/desktopbee_action` remain.
- [x] Run `npm test -- scripts/decisions-browser-lane-copy.test.mjs` and confirm it fails before production changes.

## Task 2: Update Decisions Copy

- [x] Update browser/web lane prose in `DECISIONS.md`.
- [x] Keep compatibility ids, route paths, config keys, and function names unchanged.
- [x] Run `npm test -- scripts/decisions-browser-lane-copy.test.mjs` and confirm it passes.

## Task 3: Verify And Ship

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Commit and push to `main`.
