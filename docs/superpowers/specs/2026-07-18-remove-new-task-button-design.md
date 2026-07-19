# Remove "+ New task" Sidebar Button — Design

## Problem

The console's left sidebar (`<section class="col board">`, `src/daemon/console.ts:1812`)
opens with a `＋ New task` button (`id="newTaskNav"`, line 1813) that calls
`showNewTaskPanel()` to swap the center pane for a manual task-creation form
(`#taskForm`, lines 1819-1893, submitted by `createTask()` at line 10000, which POSTs to
`server.ts`'s `POST /tasks`).

Task creation now also flows through Chat: Flash's `escalate_to_task` MCP tool
(`src/lib/flash/flash-mcp.ts:121`, dispatched at line 606) lets an operator describe work
conversationally and have Flash create the task with reasoning/context attached, entirely
independent of this sidebar button — confirmed by grep, `escalate_to_task` never touches
`console.ts` or calls `POST /tasks` through the browser at all; it creates the task
server-side.

Keeping a second, manual entry point in the sidebar is a duplicate, lower-context path to
the same outcome — the request is to remove that entry point so Chat is the one clear way
to create a task, while the read-only Board (`#boardSec`/`renderBoard()`, lines 1895-1898
and 2452) continues to show existing tasks by lane.

## Options considered

1. **Remove the button and the entire task-creation form/backend path** (`#taskForm`,
   `showNewTaskPanel`, `_closeNewTaskPanel`, `createTask()`, and the `POST /tasks` route).
   Rejected as this task's scope. `_closeNewTaskPanel()` is referenced from 10 other
   call sites across the file as part of a shared "close whatever panel is open before
   opening another" guard pattern (alongside Flash/Brain/Roles/Tools/Goals panels) —
   ripping it out means touching every one of those unrelated nav functions, a much larger
   and riskier change than "remove a button." `POST /tasks` is also the same route the
   whole app's task-creation model is built on (used by `runSelectedCommand` and other
   flows per existing tests) — not itself the redundant entry point being asked about.

2. **Hide the button with CSS (`display:none`) but leave the markup/handler wired.**
   Rejected. Leaves a dead but clickable-if-unhidden button in the DOM and doesn't satisfy
   "remove" — the button, its id, and its position in `syncNav()`'s active-state map should
   actually go, not just become invisible.

3. **Remove the button element and its `syncNav()` entry; replace it with a short static
   hint pointing at Chat; leave the now-unreachable-via-UI form code
   (`showNewTaskPanel`/`_closeNewTaskPanel`/`createTask`/`#taskForm`/`POST /tasks`)
   in place.** **Chosen.** This is the minimal change that satisfies the actual ask: the
   sidebar no longer offers a second way to start a task, and users are told where to go
   instead. The remaining form code becomes inert (nothing calls `showNewTaskPanel()`
   anymore) but stays because it's cross-referenced by unrelated panel-closing guards
   throughout the file; deleting it is a separate, larger cleanup out of scope here (noted
   below for a future pass).

## Design

**Removed:**
- `src/daemon/console.ts:1813` — the `<button id="newTaskNav" onclick="showNewTaskPanel()">＋
  New task</button>` element.
- `src/daemon/console.ts:2097` — the `newTaskNav: _taskFormInSession` entry in `syncNav()`'s
  `active` map (the element it targeted no longer exists; `syncNav()` already guards with
  `if (el)` per id, so leaving stale entries wouldn't break anything, but removing it keeps
  the map accurate to what's actually in the DOM).

**Added:**
- A short static hint in the button's place, e.g.
  `<div class="new-task-hint">Create tasks via Chat escalation</div>`, styled with existing
  muted-text conventions (matching e.g. `.hint`/`.muted` classes already in the stylesheet
  — implementer confirms exact class at build time) so it reads as informational, not
  interactive.

**Unchanged (explicitly, per Option 3):**
- `#taskForm`, `showNewTaskPanel()`, `_closeNewTaskPanel()`, `createTask()`, and
  `POST /tasks` all remain — no longer reachable from the sidebar, but not deleted.
- `#boardSec` / `renderBoard()` (the read-only Board/queue view) — untouched.
- `.addbtn` CSS — untouched; it's shared by ~15 unrelated buttons elsewhere in the file
  (skill dialogs, scheduled items, etc.), confirmed by grep.

## Scope

- `src/daemon/console.ts` — remove the button (line 1813), remove its `syncNav()` entry
  (line 2097), add the static hint markup in its place.
- `src/daemon/console.test.ts` — five existing tests assert the button's presence/position
  and must be updated to match its removal (not deleted wholesale — each test's *other*
  assertions about surrounding structure still apply):
  - `"+ New task and task creation remain after removing the shortcut"` (line 1821) —
    button assertion removed; `createTask`/`showNewTaskPanel` function-preserved
    assertions stay (they're still real functions in the source).
  - `"board column has Flash nav directly under New task"` (line 1829) — Flash nav is now
    the first button in the board column; ordering assertion updates accordingly.
  - `"board column's Overview nav is gone; + New task is the first button"` (line 1848) —
    first-button assertion changes from `showNewTaskPanel()` to `showFlashPanel()`.
  - `"new task and task selection remain intact"` (line 1881) — the
    `onclick="showNewTaskPanel()"` button assertion is removed (function-preserved
    assertions stay).
  - `"primary left nav uses a single active color convention"` (line 2928) — the
    `id="newTaskNav"` and `syncNav` `newTaskNav:` assertions are removed; the
    `closeSession` guard assertion (`if (_taskFormInSession) _closeNewTaskPanel()`) stays,
    since `closeSession` itself is untouched.
  - New/updated assertion: the hint text renders in the sidebar and the button markup is
    gone (`assert.doesNotMatch(CONSOLE_HTML, /＋ New task/)`, `assert.match(CONSOLE_HTML,
    /Create tasks via Chat escalation/)`).

## Explicitly out of scope (noted for a future pass, not actioned here)

- Deleting the now-UI-unreachable `#taskForm`/`showNewTaskPanel`/`_closeNewTaskPanel`/
  `createTask()` code and the 10 defensive `if (_taskFormInSession) _closeNewTaskPanel();`
  guard call sites scattered across other panel functions. A real cleanup, but a
  separate, larger change than removing one entry point — flagged here rather than
  bundled in.
- Any server-side change to `POST /tasks` — it's shared infrastructure, not the redundant
  UI path.
