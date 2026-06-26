# Console Overview Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-26-console-overview-navigation-design.md`

All edits in `src/daemon/console.ts` + `src/daemon/console.test.ts`. No server changes.

## Task 1 — RED: tests

- [ ] `"board column has an Overview nav above + New task"`:
  - `assert.match(CONSOLE_HTML, /id="overviewNav"/)`
  - `assert.ok(CONSOLE_HTML.indexOf('id="overviewNav"') < CONSOLE_HTML.indexOf("＋ New task"))`
  - `assert.match(CONSOLE_HTML, /onclick="showOverview\(\)"/)`
- [ ] `"showOverview clears the selected task and renders the overview"`:
  - js matches `/function showOverview\(\)\s*\{/`
  - extract body; assert it matches `/state\.selected = null/` and `/renderOverview\(\)/`
- [ ] `"task detail renders a Back to overview action"`:
  - js matches `/ov-back/` and the selectTask `#session` markup includes
    `showOverview()` (assert the selectTask body matches `/ov-back[\s\S]*showOverview\(\)/`).
- [ ] `"Escape returns to Overview only outside editable fields"`:
  - js matches `/function isEditableTarget\(/`
  - js matches `/e\.key !== "Escape"/` (early return)
  - js matches `/\.overlay\.open/` (modal guard)
  - js matches `/contentEditable|isContentEditable/`
- [ ] `"new task and task selection remain intact"`:
  - `assert.match(CONSOLE_HTML, /toggleForm\('taskForm'\)/)`
  - js matches `/onclick="selectTask\(/` (cards still selectable in renderBoard)
  - js matches `/function createTask\(/`
- [ ] Run `npm test` — watch fail.

## Task 2 — GREEN: CSS

- [ ] Add `.ov-nav` (compact full-width nav row) + `.ov-nav.active` + `.ov-back`
  styles near the board/overview CSS, dark-theme vars only.

## Task 3 — GREEN: markup

- [ ] In `section.col.board`, insert `<button class="ov-nav" id="overviewNav"
  onclick="showOverview()">⌂ Overview</button>` between the `<h2>Board…</h2>` line
  and the `＋ New task` button.

## Task 4 — GREEN: functions

- [ ] Add `showOverview()`, `updateOverviewNav()`, and `isEditableTarget(el)`.
- [ ] Call `updateOverviewNav()` at the end of `renderBoard()`.
- [ ] In `selectTask()`'s `#session` `<h1>` markup, add the `← Overview`
  breadcrumb button (`linklike ov-back`) before/within the title row.
- [ ] Register the document `keydown` Escape listener (next to the other
  top-level `document.addEventListener` calls), with the editable + overlay guards.

## Task 5 — Gates

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `node scripts/scope-wall.mjs`
- [ ] `npm run verify:portal`

## Task 6 — Commit & push to main

- [ ] Stage console.ts, console.test.ts, the two superpowers docs; commit; push.
