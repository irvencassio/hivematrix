# Remove AI-news Video Board Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-26-remove-ai-news-video-board-button-design.md`

All edits in `src/daemon/console.ts` + `src/daemon/console.test.ts`. No server or
video-lib changes.

## Task 1 — RED: tests

- [ ] `"board no longer renders the hardcoded AI-news video shortcut"`:
  - `assert.doesNotMatch(CONSOLE_HTML, /AI-news video/)`
  - js `assert.doesNotMatch(js, /draftVideoNow/)` (function + wiring gone)
- [ ] `"+ New task and task creation remain"`:
  - `assert.match(CONSOLE_HTML, /＋ New task/)`
  - `assert.match(CONSOLE_HTML, /toggleForm\('taskForm'\)/)`
  - js `assert.match(js, /function createTask\(/)`
- [ ] Run `npm test` — watch fail (string still present).

## Task 2 — GREEN: remove the button

- [ ] Delete the `🎬 AI-news video` `<button>` line in `section.col.board`.

## Task 3 — GREEN: remove the unused function

- [ ] Delete `draftVideoNow()` and its leading comment block (now unused).

## Task 4 — Gates (prove capability + portal still intact)

- [ ] `npm run typecheck`
- [ ] `npm test` (includes `news-intent.test.ts`, `review.test.ts` — video intent
  capability still passes)
- [ ] `node scripts/scope-wall.mjs` (no Bee regressions)
- [ ] `npm run verify:portal` (HeyGen portal workflow intact)

## Task 5 — Commit & push to main

- [ ] Stage console.ts, console.test.ts, the two superpowers docs; commit; push.
