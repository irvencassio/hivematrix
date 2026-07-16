# Remove Overview Section — Design

> **Autonomous self-improvement task.** This session is non-interactive (no operator available for
> turn-by-turn brainstorming Q&A), so this doc follows the Superpowers brainstorming format —
> problem, approaches considered, recommended design — as a single documented decision rather than
> a live back-and-forth. The operator reviews the resulting diff/commit, not this doc, before it
> ships (release is explicitly out of scope — see Finishing in the plan doc).

## Problem (dispatch ask, verified against actual code)

The dispatch asks to remove the "Overview" section from the HiveMatrix console UI because, with
the left-sidebar consolidation now complete (Agents section — `191ac7d9`; Scheduled section
rename; Chat/Memory/Roles/Tools/Goals panels; Board), Overview shows the same information
redundantly.

**Verified against HEAD `c91da580`:** Overview is `renderOverview()` (`console.ts:2083-2105`), the
content rendered into the center `#session` column whenever no task/skill/panel is open — it is
the app's default/landing view (`_currentView = "overview"`, `console.ts:2321`; `getStoredView()`
falls back to `"overview"`, `console.ts:2323-2327`; `refresh()`'s idle branch calls it directly,
`console.ts:5742`). It renders four blocks:

1. One card per board lane (queued/in progress/review/done/failed) with a task count, click-through
   to that lane on the Board.
2. A "scheduled" card — count of active directives.
3. A "pending approvals" card — count of pending approvals.
4. Pack dashboard cards (`renderPackDashboardCards()`, `console.ts:2055-2069`) — one card per
   installed pack with up to 3 metrics and an optional CTA, from `GET /packs/dashboard-cards`.

**Premise check — 3 of 4 blocks are exactly the redundancy described; the 4th needs one explicit
scoping call:**

- Lane/task counts: the Board (left column) already groups tasks by lane visually — this is the
  same count, not just "available elsewhere" but literally the same data source (`state.tasks`)
  rendered a second way.
- "scheduled": the Scheduled section (`#dirSec`, `renderDirectives()`) already lists the active
  directives this card only counts.
- "pending approvals": the right column's `#approvals` block (`renderApprovals()`) is
  **always visible**, not gated behind Overview — this card duplicates a count of something
  already on screen at all times.
- Pack dashboard cards: **not** reproduced anywhere else in this console today. However,
  `COMPONENT-MAP.md:101` documents that every pack's dashboard card has "a companion equivalent" —
  i.e., this data is a general pack-registry concept surfaced on the companion apps
  (`[[companion-ports-2026-07]]`), not something invented for the console's Overview page.
  Dropping the *console's* rendering of it does not delete the data or its only surface — see
  Non-goals for the resulting scope line (keep the backend endpoint, drop only the console's
  fetch/render of it).

No architectural doc (`COMPONENT-MAP.md`, `DECISIONS.md`) mentions "Overview" — it is a pure
UI-layer concept with no kernel-primitive weight, so no `DECISIONS.md` entry is needed for its
removal (nothing is being replaced; a display page is being deleted).

## Current state — full footprint (research pass, HEAD `c91da580`)

Everything lives in one file, `src/daemon/console.ts` (10,127 lines — the whole console is a
server-rendered template literal; there is no separate component tree). Overview-exclusive vs.
shared, confirmed by reading every call site directly:

**Overview-exclusive (deleted outright):**
- CSS: `.overview`, `.ov-head`, `.ov-grid`, `.ov-card`/`.ov-card[onclick]`/`.ov-card.warn/.ok/.err`,
  `.ov-num`, `.ov-lbl`, `.ov-hint` (`console.ts:294-304,312-313`)
- `#overviewNav` button (`console.ts:1819`, the "⌂ Overview" sidebar entry point)
- `packMetricLabel()` (`console.ts:2047-2053`)
- `renderPackDashboardCards()` (`console.ts:2055-2069`)
- `renderOverview()` (`console.ts:2083-2105`)
- `focusBoardLane()` (`console.ts:2127-2132`, only ever invoked from a now-deleted lane-count
  card's `onclick`)
- `updateOverviewNav()` (`console.ts:2158`, thin wrapper — same one-line-wrapper-per-nav-item
  pattern as `updateGoalsNav()`/`updateFlashNav()`/etc.; deleted the same way those would be if
  their nav item were removed)
- `/packs/dashboard-cards` fetch + `state.packCards` assignment inside `refresh()`
  (`console.ts:5731-5732,5736`)
- `"overview"` entries in `HM_VALID_VIEWS`/`getStoredView()`/`restoreLastView()`
  (`console.ts:2320-2327`, `3279-3287`)

**Shared — kept, only the Overview-specific *usage* is removed:**
- `.ov-nav`/`.ov-back` CSS classes (`console.ts:231-235,238`) — style every other sidebar nav
  button (Chat/Memory/Roles/Tools/Goals) and every "back" link across 10 panels. **Not deleted.**
- `syncNav()` (`console.ts:2139-2156`) — drop only the `overviewNav`/`overviewActive` keys, keep
  the function (it's the single source of truth for every other nav item's highlight).
- `GET /tasks`, `GET /directives`, `GET /approvals/pending` — feed Board/Scheduled/Approvals
  respectively; only Overview's redundant counting of them goes.
- `laneColor`/`LANE_DEFS` (`console.ts:1986`) — stay for `renderBoard()`.
- The 10 `<button class="linklike ov-back" onclick="showOverview()" ...>← Overview</button>`
  call sites (`console.ts:2764,3373,3889,3921,6039,7022,7140,7665,7802,7898`) — these are the
  generic "close whatever's open, return to idle" affordance from 8 different panels/detail
  views (task detail, Goals, skill/command detail ×2, New Task, Chat, Memory, Roles, Tools ×2).
  The mechanism stays; it's repointed (see Recommended design).
- The Escape-key handler (`console.ts:6567-6575`) — same repoint, not a deletion.
- `renderBoard()`'s nav-sync call site (`console.ts:2532`, currently `updateOverviewNav();`) —
  the *wrapper* is deleted, but the `syncNav()` call it performs must survive (it's the only
  nav-sync triggered after every board re-render); replaced with a direct `syncNav()` call.

**Not implicated at all:** `/connectivity`, `/metrics`, `/onboarding`, `/lanes`, `/mcp` and their
renderers (`renderConn`, `renderMetrics`, `renderOnboarding`, `renderAgents`) — none of these are
fetched or rendered by Overview.

**Tests:** `console.test.ts` (3,732 lines) has ~20 spots referencing Overview — some
Overview-exclusive (delete), most are shared tests with one or two Overview-specific assertions
inside them (update in place, don't delete the test). `scripts/console-overview-colors.test.mjs`
and `scripts/console-scheduled-rename.test.mjs` each have exactly one Overview-exclusive test
among several unrelated ones (`laneColor` coloring, wallpaper blur, Scheduled-section renaming) —
full inventory in the plan doc.

## Approaches considered

**A. Leave the center pane fully blank when idle** (delete `renderOverview()`, replace every call
site with nothing). Rejected: worse than what shipped before Overview ever existed. The file
already ships a static idle placeholder for the pre-hydration instant
(`console.ts:1904`, `<div class="session-empty">Select a task to inspect its session.</div>`) —
going to true blank would throw away an already-correct, already-designed empty state for no
reason.

**B. Promote another section (Chat) to be the new default/landing view.** Rejected: this changes
more behavior than the dispatch asked for. The dispatch's scope is "remove Overview," not
"pick a new home view" — redirecting boot/back/Escape into Chat would alter muscle memory and
turn every "return to idle" action into "jump into Chat," a materially different UX decision the
dispatch never raised. Also the larger diff: every one of the 10 back-links and the Escape handler
would need Chat-specific wiring instead of a generic close.

**C. (Recommended) Reuse the existing static empty-state placeholder as the idle render, and
rename the existing "return to idle" entry points instead of inventing new ones.** Swap
`renderOverview()`'s body for the one-line placeholder markup that already exists in this file for
the exact same moment (pre-hydration boot). Rename `showOverview()` → `closeSession()` and
`renderOverview()` → `renderSessionEmpty()` — same guard conditions, same state resets, only the
rendered content and the name change (the name "Overview" no longer describes what the function
does once the card grid is gone; `closeSession()`/`renderSessionEmpty()` match the file's own
established vocabulary for the center pane, `#session`/`.col.session`/`.session-empty`). Zero new
concepts, zero new endpoints, zero new CSS — pure subtraction plus a rename for accuracy.

## Recommended design

### Idle render — replaces `renderOverview()`

```js
// Center pane at rest — shown when nothing is selected and no panel is open.
// Reuses the same placeholder markup the static pre-hydration shell already
// ships (console.ts:1904) so there's exactly one "idle" visual, not two.
function renderSessionEmpty() {
  if (state.selected || state.selectedSkillOrCommand || _taskFormInSession || _flashState.panelOpen || _brainState.panelOpen || _rolesState.panelOpen || _toolsState.panelOpen || _goalsState.panelOpen) return;
  setFlashSessionMode(false);
  const el = document.getElementById("session");
  if (!el) return;
  el.innerHTML = '<div class="session-empty">Select a task to inspect its session.</div>';
}
```

Guard conditions are copied verbatim from `renderOverview()` — this is a content swap, not a
behavior change.

### Return-to-idle entry point — replaces `showOverview()`

```js
// Closes whatever's open (task, skill/command detail, New Task form, any of the
// 5 panels) and returns the center pane to its idle state. Renamed from
// showOverview(): same resets, no more "Overview" destination to name it after.
function closeSession() {
  state.selected = null;
  state.selectedSkillOrCommand = null;
  _skSel = '';
  _ctxTask = null;
  if (_taskFormInSession) _closeNewTaskPanel();
  _flashState.panelOpen = false;
  _brainState.panelOpen = false;
  _rolesState.panelOpen = false;
  _toolsState.panelOpen = false;
  _goalsState.panelOpen = false;
  setStoredView('');
  setFlashSessionMode(false);
  renderBoard();
  renderSkillList();
  renderSessionEmpty();
  syncNav();
}
```

### Caller migration (mechanical, one rename applied at every site)

- `console.ts:1819` — delete the `#overviewNav` button element entirely (no replacement; Board is
  the sidebar's permanent top item now).
- `console.ts:2764,3373,6039,7022,7140,7665,7802,7898` (8 sites) and `console.ts:6574` (Escape
  handler) — `showOverview()` → `closeSession()`.
- `console.ts:3889,3921` (`_closeSkillPanel()`'s own back-links) — these already call
  `_closeSkillPanel()` directly, not `showOverview()`; only `_closeSkillPanel()`'s own body
  (`console.ts:3859-3871`) needs its trailing `renderOverview();` → `renderSessionEmpty();`.
- `console.ts:2794` (`deleteTask()`) — `renderOverview();` → `renderSessionEmpty();`.
- `console.ts:5742` (`refresh()`) — `else renderOverview();` → `else renderSessionEmpty();`.
- `console.ts:2532` (`renderBoard()`) — `updateOverviewNav();` → `syncNav();` (the wrapper is
  deleted; the call it made must not be, since nothing else re-syncs the nav after every board
  poll — see Current state).
- Back-link button text/title, all 10 sites: `← Overview` / `title="Back to overview (Esc)"` →
  `← Back` / `title="Back (Esc)"`. (`console.ts:7802`'s variant has no `title` attribute today;
  keep it title-less, change only the label and `onclick`.)
- Escape handler comment (`console.ts:6567-6568`): update to describe closing the open
  task/panel, not "returns to the Overview."

### View persistence

```js
var HM_VALID_VIEWS = ["flash", "brain", "roles", "tools", "goals"];
var _currentView = "";

function getStoredView() {
  try {
    var v = localStorage.getItem("hm_last_view");
    return HM_VALID_VIEWS.indexOf(v) !== -1 ? v : "";
  } catch (e) { return ""; }
}
```

`restoreLastView()` (`console.ts:3279-3287`) keeps its `if/else if` chain for
flash/brain/roles/tools/goals unchanged; only the trailing comment changes (from "'overview' is
already the default rendered state on boot" to noting the empty-string/no-stored-view case is the
no-op idle default).

**Backward-compat note, not a migration task:** a browser that already has `hm_last_view: "overview"`
in `localStorage` from before this change needs no cleanup — `HM_VALID_VIEWS.indexOf("overview")`
is `-1` once `"overview"` is dropped from the array, so `getStoredView()` already falls back to
`""` (idle) for that stale value on its own. Verified this is the only place that string is read.

`saveScrollPosition(view)`/`restoreScrollPosition(view)` (`console.ts:2340-2358`) need **no
changes** — they key off `SCROLL_TARGETS` (`{flash, tools, goals}`) and already no-op via
`if (!sel) return;` for any view not in that map, `""` included exactly like `"overview"` did
before.

### Data/endpoint scoping

Remove the frontend's fetch of `/packs/dashboard-cards` and the `state.packCards` assignment from
`refresh()` (`console.ts:5731-5732,5736`) along with `packMetricLabel()`/
`renderPackDashboardCards()`. **Do not touch** the backend route (`server.ts:3072-3076`,
`getPackDashboardCards()`) — per `COMPONENT-MAP.md:101` this data has a companion-app consumer
outside this repo's frontend; deleting the live endpoint on the strength of a UI-cleanup dispatch
risks breaking that surface with no way to verify it from here. This is the one place "no data
loss" requires an explicit boundary rather than a blanket "delete everything Overview touched."

## Non-goals

- **Not deleting `GET /packs/dashboard-cards` or `getPackDashboardCards()`.** Console-side
  consumption goes; the endpoint itself is out of scope (see Data/endpoint scoping above).
- **Not picking a new "default" view.** Idle means idle — the empty placeholder, not a redirect
  into Chat or any other panel (Approach B, rejected).
- **Not touching `laneColor`/`LANE_DEFS`/`.ov-nav`/`.ov-back`** — all shared with Board and the
  other 5 sidebar nav buttons, unaffected by Overview's removal.
- **Not reconciling the separate `fix-goals-data-loss` worktree** (`.claude/worktrees/`), which
  has its own divergent copy of `console.ts`/`console.test.ts` including some Overview-touching
  tests. Out of scope; whoever merges that branch later reconciles it against whatever lands here.
- **No `DECISIONS.md` entry.** Pure subtraction of a UI-only concept with no kernel-primitive
  weight (Event/Task/Directive/Policy/Persona/Memory) and no persistent store — nothing is being
  replaced, so there's nothing to name per the Complexity Budget rule (that rule gates *additions*
  that need a "what this replaces or deletes" entry; a standalone removal has no such gap to fill).

## Testing approach

Following this file's existing `console.test.ts` conventions (regex/string assertions against the
`CONSOLE_HTML`/function-source constants, plus `extractFunctionBlock`-style execution tests for
stateful functions):

1. **Idle render swap**: a test asserting that with nothing selected and no panel open, `#session`
   contains `.session-empty` with the existing placeholder text, and does **not** contain
   `.overview`/`.ov-grid`. Replaces the two existing Overview-content tests
   (`console.test.ts:1355-1359,1361-1367`).
2. **Nav button gone**: assert `id="overviewNav"` no longer appears in `CONSOLE_HTML`. Replaces
   the existing "board column has an Overview nav" test (`console.test.ts:1667-1675`), inverted.
3. **`closeSession()` behavior**: execution test — after selecting a task then calling
   `closeSession()`, `state.selected` is null and the session pane shows the empty placeholder.
   Replaces `console.test.ts:1677-1685`.
4. **Back-link repoint**: assert no remaining `showOverview(` or literal `← Overview` text exists
   anywhere in `CONSOLE_HTML`; assert `← Back`/`closeSession()` appears the expected number of
   times (10 sites, 8 calling `closeSession()` directly + the 2 `_closeSkillPanel()` sites keep
   their own handler but must no longer say "Overview"). Updates
   `console.test.ts:1687-1693,2906-2910`.
5. **Escape handler**: existing test at `console.test.ts:1695+` ("Escape returns to Overview only
   outside editable fields") — update to assert it calls `closeSession()`/reaches the idle state,
   same guard conditions (not editable target, no open modal).
6. **View persistence**: update `getStoredView()` tests (`console.test.ts:3036-3043`) to assert
   default/fallback is `""` not `"overview"`; update the view-switching table test
   (`console.test.ts:3289`) to drop the `["showOverview", "overview"]` row entirely (no function
   maps to that view string anymore); update `restoreLastView`/scroll-position tests
   (`console.test.ts:3337-3339,3390-3391,3424`) to use `""` instead of `"overview"` as the
   no-op-case input, per the design decision above.
7. **Shared-test cleanup**: `console.test.ts:1021,1105,1111,2758-2766` — drop the
   `overviewNav`/`overviewActive`/`"showOverview"` references inside these otherwise-unrelated
   shared tests (nav-sync, Roles-panel mutual exclusivity) without deleting the tests themselves.
8. **`scripts/console-overview-colors.test.mjs`** — delete only the "card() passes numColor to
   ov-num element" test (lines 23-26); keep the 3 `laneColor` tests and the 2 wallpaper tests
   (unrelated, mislabeled by file name only).
9. **`scripts/console-scheduled-rename.test.mjs`** — delete only the "overview card label is
   scheduled not active directives" test (lines 31-40); keep the other 4 (Scheduled section
   heading/buttons, New Task form) — they test features that survive this change.

Full task-by-task breakdown with exact RED/GREEN steps: see the accompanying plan doc.

Implementers: this doc's line numbers were read directly from HEAD `c91da580` at design time —
confirm current line numbers against the real file before editing (the two-stage review after each
task should catch drift, but don't paste this doc's line citations on trust).
