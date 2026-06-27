# New Task project picker + derived path — Design

> Date: 2026-06-27
> Status: Approved (spec pre-approved by founder; clarifying questions defaulted to the feasible/recommended options)

## Problem

The **New task** form shows two project controls that feel redundant and technical:

- a searchable **Project** combobox (`#t_project_search` → `#t_project_dropdown`)
- a raw, freely-editable **Project path (working dir)** input (`#t_path`, default `/tmp`)

Two freeform fields invite a silent mismatch: the chosen project name and the
edited path can disagree, and the path is an implementation detail an operator
should not have to type. The header board filter (`#projectSel`) also writes the
form's `#t_path` *without* updating the picker's selected name — the exact
desync the founder called out (`project = hivematrix` but `projectPath = /elsewhere`).

## Current behavior (src/daemon/console.ts)

- `/projects` returns `{ name, path, sources[], hasManifest, lastModified (ISO), preSelect }`.
  There is **no** favorite/starred field — only `preSelect` (the ★ active project).
- `projectDropdownItems = [{name, path, preSelect, lastModified}]`; `selectedProjectName`
  holds the chosen name; `#t_path` holds the path.
- `selectProjectFromDropdown(name, path)` sets `selectedProjectName` + the search
  input value + `#t_path`.
- `renderProjectDropdown()` filters by **name only**; sorts recent/name; click-to-select.
- No keyboard support; no "use another folder" affordance.
- `loadProjects()` pre-fills the ★ project into the search box and `#t_path`.
- Header `#projectSel` change writes `#t_path` **but not** `selectedProjectName` → mismatch vector.
- `createTask()` reads `projectPath` from `#t_path`, `project` from `selectedProjectName`,
  validates `description && projectPath`, and POSTs both.
- Backend `POST /tasks` normal path: `Task.create({ _id, ...body })` — `project` and
  `projectPath` flow through unchanged; the console path does **not** require `$HOME`
  (so the contract is unchanged; no migration). The WKWebView has **no** native
  dialogs/folder picker (the app ships in-DOM `hmAlert/hmConfirm/hmPrompt`).

## Decision

### 1. One Project control; path is derived + hidden

- `#t_path` becomes `type="hidden"` — the *derived path store*, never user-typed.
  Keeping the element (vs. a JS var) means `loadProjects`, header-sync, and
  `createTask` keep reading/writing one place with minimal churn.
- A subtle, **non-editable** selected-project row (`#t_project_selected`) renders
  under the combobox: the project name + the path as muted secondary text (both
  ellipsis-clamped so the narrow board column never overflows).
- The combobox `#t_project_search` keeps the chosen name as its value (Mac
  combobox feel) and acts purely as a *filter*.

### 2. Single source of truth: `setTaskProject(name, path, custom)`

One function is the **only** writer of the selection, so name and path can never
diverge:

```js
function setTaskProject(name, path, custom) {
  selectedProjectName = name || "";
  selectedProjectCustom = !!custom;
  const hidden = document.getElementById("t_path");
  if (hidden) hidden.value = path || "";
  const search = document.getElementById("t_project_search");
  if (search) search.value = name || "";
  renderSelectedProject();   // fills #t_project_selected (name + muted path, ★ if known)
}
```

Every selection path routes through it: dropdown click, keyboard Enter, the ★
pre-select in `loadProjects`, header-filter change, and the custom-folder confirm.

### 3. Filter by name **and** path (recent usage via sort)

`renderProjectDropdown()` predicate becomes
`p.name.toLowerCase().includes(s) || p.path.toLowerCase().includes(s)`. The
existing **Most recent / Name A–Z** toggles are kept (recent = `lastModified`),
restyled to sit cleanly in the dropdown header.

### 4. Keyboard support

A `keydown` handler on `#t_project_search` over the currently-visible
(filtered+sorted) list, tracked in `projectVisibleItems` with `projectHighlightIndex`:

- **ArrowDown** opens the dropdown if closed, moves highlight down (clamped), scrolls into view.
- **ArrowUp** moves highlight up (clamped).
- **Enter** selects the highlighted item via `setTaskProject(...)`; `preventDefault`.
- **Escape** closes the dropdown; `preventDefault` + `stopPropagation` so it does
  not bubble to the document Escape→Overview handler (that handler already ignores
  editable focus, so this is belt-and-suspenders).

The highlighted row gets a `.active` class (distinct from `.selected`, which marks
the currently-chosen project).

### 5. "Use another folder…" — explicit, advanced, never accidental

A subtle `linklike` action under the picker toggles a disclosure (`#t_custom_folder`)
holding a one-off path input (`#t_custom_path`, placeholder `~/path/to/folder`) plus
**Use this folder** / Cancel. Confirm derives the project **name from the folder
basename** (e.g. `~/work/foo` → `foo`; empty segment → `custom`) and calls
`setTaskProject(basename, typedPath, /*custom*/ true)`. The backend normalizes
`~`/`$HOME`. This is the only way to reach an arbitrary path, so a custom path is
always a deliberate act — no silent mismatch.

### 6. Decouple the board filter from the picker (kill the mismatch vector)

Header `#projectSel` change, instead of writing only `#t_path`, routes a real
project through `setTaskProject(name, path)` (name+path together) and leaves the
form untouched on **(all projects)**. `loadProjects()` likewise sets its initial
default through `setTaskProject` — the ★ `preSelect` project, falling back to the
most-recent project when none is pre-selected ("default to current/most recent").

### 7. Validation + payload

`createTask()` validates with human-readable messages, in order:

- description → `"Please describe what the agent should do."`
- a selected project with a path → `"Please choose a project, or use another folder."`
- a model → `"Please choose a model."`
- (existing attachment upload/error guards kept)

Payload is unchanged in shape — `{ project: selectedProjectName, projectPath: <hidden>, … }`
— but both now originate from the single selected-project state, so they cannot
mismatch.

## Non-disruption guarantees

- Backend `POST /tasks` is untouched (still accepts `project`/`projectPath`); no schema/migration.
- Model selector and attachments flows are unchanged.
- Header board filter still filters the board; it just no longer desyncs the picker.
- Directive forms (`#d_path`, `#de_path`) and the command runner (`#commandPath`)
  are **out of scope** — they keep their existing path inputs.

## Frontend requirements honored

- One visible Project control; path shown only as muted secondary text, never an input.
- Searchable dropdown with name/path filtering, recent/name sort, full list, keyboard + mouse.
- Sentence-case labels; consistent spacing; combobox feel; ellipsis clamps for the narrow column.
- Hierarchy: Description → Project → Model → Attachments → Create/Cancel.

## Tests (TDD, console source-level; task-form-scoped where needed)

Scope path assertions to the task-form slice
(`CONSOLE_HTML` between `id="taskForm"` and `id="board"`) so the out-of-scope
directive path field doesn't pollute results.

1. The task form's path field is **hidden**, not a primary editable input, and the
   "Project path (working dir)" placeholder copy is gone from the task form.
2. `setTaskProject` is the single selection writer (sets `selectedProjectName` + `#t_path`).
3. The dropdown filter matches name **or** path.
4. Selecting a project sets both name and path (dropdown + Enter route through `setTaskProject`).
5. `createTask` builds the payload from the selection (no freeform path read), so
   `project`/`projectPath` cannot mismatch.
6. Keyboard handlers exist: ArrowDown, ArrowUp, Enter, Escape.
7. "Use another folder…" is an explicit disclosure that derives the name and marks `custom`.
8. Human-readable validation for description / project / model.
9. Existing flows intact: `createTask` present, model selector + attachments untouched, `+ New task` toggles.

## Gates

- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`

## Out of scope (non-goals)

- No board/lane redesign; no change to project discovery internals or task routing.
- Directive/command path inputs unchanged.
- No native folder picker (infeasible in this WKWebView); no release cut.
