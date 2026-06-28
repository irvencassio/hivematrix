# Flight Task Card Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-28-flight-task-card-indicator-design.md`

- [x] RED: Add a focused server test in `src/daemon/server.test.ts` that creates and starts a Flight, moves the linked child task/item into review, calls `GET /tasks`, and asserts the linked task carries `flightContext` with package title, item status, and landed/total counts while an unrelated task has no `flightContext`.

- [x] RED: Add a console-rendering source test in `src/daemon/console.test.ts` asserting the board renderer calls a Flight context helper, renders `Blocks Flight`, includes item status, and includes landed count, while the helper returns an empty string when no context exists.

- [x] GREEN: Add a small payload enrichment helper in `src/daemon/server.ts` for `/tasks` and `/tasks/:id`. Join `work_package_items.createdTaskId` to `work_packages`, compute landed and total counts per package, and attach `flightContext` only to linked task rows.

- [x] GREEN: Add compact console styling and a `flightContextBadge(t)` helper in `src/daemon/console.ts`; append it inside each board card after the existing badge row.

- [x] REFACTOR/VERIFY: Run focused server and console tests, then run `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
