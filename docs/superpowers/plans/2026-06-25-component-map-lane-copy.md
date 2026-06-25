# Component Map Lane Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Task 1: Lock Component Map Lane Copy

- [x] Add `scripts/component-map-lane-copy.test.mjs`.
- [x] Assert `COMPONENT-MAP.md` contains lane headings for Browser, Terminal, Desktop, Message, Mail, Market Insight, Voice, Review, and Memory where applicable.
- [x] Assert known PascalCase public Bee brands are absent from `COMPONENT-MAP.md`.
- [x] Assert lower-case compatibility ids such as `browserbee`, `webbee`, and `desktopbee` may remain.
- [x] Run `npm test -- scripts/component-map-lane-copy.test.mjs` and confirm it fails before production changes.

## Task 2: Update Component Map Copy

- [x] Update `COMPONENT-MAP.md` to use lane names.
- [x] Collapse Browser/Web into Browser Lane while documenting compatibility ids.
- [x] Preserve compatibility ids for stable routes/sources/contracts.
- [x] Run `npm test -- scripts/component-map-lane-copy.test.mjs` and confirm it passes.

## Task 3: Verify And Ship

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Commit and push to `main`.
