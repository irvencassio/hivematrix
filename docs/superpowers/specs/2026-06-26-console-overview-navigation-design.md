# Desktop console: explicit Overview navigation — Design

> Date: 2026-06-26
> Status: Approved (recommendation pre-approved; code inspection confirms it is implementable)

## Problem

The center column shows a useful **Overview** (`renderOverview()`) when no task
is selected, but it is only reachable as an *accidental empty-selection state*.
After clicking a task card there is no obvious way back: `state.selected` only
clears on delete/archive of the open task. The operator is stuck on a task
detail with no breadcrumb home.

## Current behavior (src/daemon/console.ts)

- `state.selected` holds the open task id (`null` = overview).
- `renderOverview()` fills `#session`, but early-returns if `state.selected` is set.
- `selectTask(id)` sets `state.selected`, re-renders the board (card gets `.sel`),
  and renders the detail into `#session`.
- Board column (`section.col.board`): `<h2>Board…</h2>`, then
  `＋ New task`, then the `🎬 AI-news video` button, then `#board`.
- `refresh()` (line ~2913): `if (state.selected) selectTask(state.selected); else renderOverview();`
- Overlays use `.overlay.open` (display:flex) for modal/dialog/settings state.

## Decision

### 1. Explicit Overview control (board column, above + New task)

Add a compact `#overviewNav` button at the very top of the board column, above
`＋ New task`:

```html
<button class="ov-nav" id="overviewNav" onclick="showOverview()">⌂ Overview</button>
```

Restrained dashboard styling (not a hero): a single full-width row that reads as
a nav target, with an `.active` state.

### 2. `showOverview()`

Clears the selection and renders the overview explicitly:

```js
function showOverview() {
  state.selected = null;
  _ctxTask = null;       // drop the open-task context binding
  renderBoard();         // clears the .sel highlight + syncs the nav active state
  renderOverview();      // fills the center column (now that selected is null)
}
```

### 3. Back-to-overview in the task detail header

In `selectTask()`'s `#session` markup, add a subtle breadcrumb action in the
title row:

```html
<button class="linklike ov-back" onclick="showOverview()">← Overview</button>
```

### 4. Keyboard: Escape clears the selected task

A single document-level `keydown` listener:

```js
function isEditableTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!state.selected) return;
  if (isEditableTarget(document.activeElement)) return;   // don't steal Esc from inputs
  if (document.querySelector(".overlay.open")) return;     // let modals own Escape
  showOverview();
});
```

### 5. Active visual state

- Overview nav is `.active` when `!state.selected`; a task card keeps its
  existing `.sel` highlight when selected.
- `renderBoard()` is the single sync point: it calls `updateOverviewNav()` at
  the end, so every path that re-renders the board (selectTask, refresh,
  showOverview) keeps the nav highlight correct.

```js
function updateOverviewNav() {
  const nav = document.getElementById("overviewNav");
  if (nav) nav.classList.toggle("active", !state.selected);
}
```

## Non-disruption guarantees

- `selectTask`, live `refresh()`, reply/retry/steer boxes, review controls, and
  the `＋ New task` flow are untouched — `showOverview()` only nulls `selected`
  and `_ctxTask` (the same fields delete/archive already null) and re-renders.
- `state.selectedProject` (project filter) is preserved — `showOverview()` never
  touches it; `renderOverview()`/`renderBoard()` already honor it.
- Escape is suppressed inside inputs/textareas/selects/contenteditable and when
  any `.overlay.open` modal is up, so it won't break the dialog's own Esc.

## Frontend requirements honored

- Restrained styling: one compact nav row, no hero/card redesign.
- No new explanatory text blocks (overview hint copy unchanged).
- Works on narrow widths: full-width button in the existing board column flow,
  no absolute positioning, no overlap.

## Out of scope

- No board/lane redesign; no changes to task creation, telemetry, or transcript.
- The `🎬 AI-news video` button is removed in a separate slice (slice 3).

## Tests (TDD, console source-level)

1. An Overview control (`#overviewNav`) exists in the board column, above
   `＋ New task`.
2. Selecting Overview clears selection (`showOverview` sets `state.selected = null`).
3. Task detail renders a Back-to-overview action (`ov-back`, `showOverview()` in
   the `#session` title markup).
4. Escape clears the selected task only when focus is not editable and no modal
   is open (`isEditableTarget`, `.overlay.open` guard, `e.key !== "Escape"`).
5. `＋ New task` behavior is unchanged (`toggleForm('taskForm')` + `createTask()`).
6. Task cards remain selectable (`onclick="selectTask(` in renderBoard).

## Gates

- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`
- `npm run verify:portal`
