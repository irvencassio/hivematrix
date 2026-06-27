# New Task Project Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-27-new-task-project-picker-design.md`

All edits in `src/daemon/console.ts` + `src/daemon/console.test.ts`. **No server changes** (POST /tasks contract unchanged).

## Task 1 — RED: tests

Add a `taskFormSlice()` helper to console.test.ts:
`CONSOLE_HTML.slice(indexOf('id="taskForm"'), indexOf('id="board"'))`.

- [ ] `"New task path field is hidden, not a primary editable input"`:
  - slice matches `/id="t_path"[^>]*type="hidden"/`
  - `assert.doesNotMatch(slice, /Project path \(working dir\)/)`
- [ ] `"New task uses one Project control with derived path as secondary text"`:
  - slice matches `/id="t_project_selected"/`
  - slice matches `/class="flbl"[^>]*>Project<\/label>|>Project<\/label>/`
- [ ] `"project selection routes through a single setTaskProject writer"`:
  - js matches `/function setTaskProject\(/`
  - body matches `/selectedProjectName =/` and `/getElementById\("t_path"\)/`
  - `selectProjectFromDropdown` body matches `/setTaskProject\(/`
- [ ] `"project dropdown filters by name or path"`:
  - `renderProjectDropdown` body matches `/\.path\.toLowerCase\(\)\.includes/`
- [ ] `"project picker supports keyboard nav (Arrow/Enter/Escape)"`:
  - js matches `/projectHighlightIndex/`, `/ArrowDown/`, `/ArrowUp/`, `/function onProjectSearchKeydown\(/`
  - keydown body handles Enter (`/e\.key === "Enter"/`) and Escape (`/e\.key === "Escape"/`)
- [ ] `"Use another folder is an explicit advanced disclosure"`:
  - slice matches `/Use another folder/`
  - slice matches `/id="t_custom_folder"/` and `/id="t_custom_path"/`
  - js matches `/function useCustomFolder\(/` and the body matches `/setTaskProject\([^)]*true\)/` (custom flag)
- [ ] `"createTask builds payload from the selection, no freeform path read"`:
  - `createTask` body matches `/selectedProjectName/`
  - body matches `/project: selectedProjectName/` (name from state, not the search box)
  - body does **not** match `/document\.getElementById\("t_project_search"\)\.value/`
- [ ] `"createTask validates with human-readable messages"`:
  - `createTask` body matches `/Please describe what the agent should do\./`
  - body matches `/Please choose a project/`
  - body matches `/Please choose a model\./`
- [ ] Keep/confirm existing intact: `"console uploads selected task files before creating a task"` still passes; model `<select id="t_model">` still present.
- [ ] Run `npm test` — watch the new tests fail.

## Task 2 — GREEN: markup (the task form)

- [ ] Change `#t_path` to `<input id="t_path" type="hidden" value="" />` (drop the
  `/tmp` default + placeholder).
- [ ] Add `<div id="t_project_selected" class="project-selected"></div>` right after
  the `.project-search` wrapper (the muted name + path row).
- [ ] Add the custom-folder affordance after the selected row:
  ```html
  <button type="button" class="linklike" onclick="toggleCustomFolder()">Use another folder…</button>
  <div id="t_custom_folder" class="custom-folder" style="display:none">
    <input id="t_custom_path" placeholder="~/path/to/folder" />
    <div class="row"><button class="create" onclick="useCustomFolder()">Use this folder</button>
    <button class="cancel" onclick="toggleCustomFolder()">Cancel</button></div>
  </div>
  ```

## Task 3 — GREEN: CSS

- [ ] Add `.project-selected` (name medium, `.ppath` muted, both ellipsis-clamped),
  `.project-item.active` (keyboard highlight = hover bg), `.custom-folder` spacing,
  near the existing `/* Project search dropdown */` block. Theme vars only.

## Task 4 — GREEN: functions

- [ ] Add module state `let selectedProjectCustom = false; let projectHighlightIndex = -1; let projectVisibleItems = [];`.
- [ ] Add `setTaskProject(name, path, custom)` — the single selection writer; calls `renderSelectedProject()`.
- [ ] Add `renderSelectedProject()` — fills `#t_project_selected` (name + muted path, ★ when the name matches a `preSelect` item); hides when nothing selected.
- [ ] Update `renderProjectDropdown()`: filter by name **or** path; store the
  filtered+sorted list in `projectVisibleItems`; apply `.active` to `projectHighlightIndex`.
- [ ] Rewrite `selectProjectFromDropdown(name, path)` to call `setTaskProject(name, path, false)` + close.
- [ ] Add `onProjectSearchKeydown(e)` (ArrowDown/ArrowUp/Enter/Escape) and wire it
  as `onkeydown` on `#t_project_search`; reset `projectHighlightIndex` in `filterProjectDropdown`/`openProjectDropdown`.
- [ ] Add `toggleCustomFolder()` and `useCustomFolder()` (derive basename → name;
  `setTaskProject(name, path, true)`; show inline error if path blank).
- [ ] `loadProjects()`: replace the direct `.value =` pre-select with
  `setTaskProject(chosen.name, chosen.path)` where `chosen = preSelect ?? mostRecent`.
- [ ] Header `#projectSel` change handler: for a real project call
  `setTaskProject(name, path)`; on `(all)` leave the form untouched (drop the raw `#t_path` write).
- [ ] `createTask()`: read path from the hidden `#t_path`; validate description →
  project (`selectedProjectName` && hidden path) → model with the human-readable
  messages; keep attachment guards; payload `{ project: selectedProjectName, projectPath, … }`.

## Task 5 — Gates

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `node scripts/scope-wall.mjs`

## Task 6 — Commit & push to main

- [ ] Stage console.ts, console.test.ts, the two superpowers docs; commit; push to main.
