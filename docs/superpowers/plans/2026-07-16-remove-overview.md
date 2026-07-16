# Remove Overview Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-07-16-remove-overview-design.md` (Approach C — reuse the
existing static idle placeholder as the "nothing selected" render, rename
`showOverview()`/`renderOverview()` to `closeSession()`/`renderSessionEmpty()` rather than
inventing new concepts, delete the four Overview-exclusive helpers and their CSS/nav button, keep
the `/packs/dashboard-cards` backend endpoint alive for its companion-app consumer).

**Scope boundary — read this first:** every change in this plan lives in `src/daemon/console.ts`,
`src/daemon/console.test.ts`, `scripts/console-overview-colors.test.mjs`, and
`scripts/console-scheduled-rename.test.mjs`. As of this plan's authoring, `git status` is clean
except two untracked docs for an unrelated same-day task
(`docs/superpowers/{specs,plans}/2026-07-16-usage-toggle-active-color*.md`) — do not touch those.
Re-run `git status` before Task 1 to confirm nothing else has landed in the working tree since;
stage only the exact files this plan touches when committing, never `git add -A`/`git add .`.

**Why 3 implementation tasks instead of ~10 tiny ones:** this is a rename/deletion sweep across a
single 10,127-line file with no static type-checking on the client JS (it's a template-literal
string — `npm run typecheck` does not see inside it; `console.test.ts`'s regex/extraction tests
are the only safety net). Splitting the sweep too finely would leave the app in a broken
intermediate state (dangling calls to a deleted function) at a task boundary, which the two-stage
review would have to review as broken. Task 1 is additive-only (safe to stop after); Task 2 is the
one atomic breaking change, paired with every test it invalidates; Task 3 is fully independent
cleanup. Each task boundary leaves `npm test` green.

## Task 1 — add `closeSession()`/`renderSessionEmpty()` alongside the existing Overview code (additive, no behavior change)

This task does **not** remove or rewire anything yet — `renderOverview()`, `showOverview()`, and
every existing call site keep working exactly as today. It only adds the two replacement
functions and proves them correct in isolation.

- [ ] In `console.test.ts`, find how existing stateful inline functions are extracted and tested
      (search for `extractFunctionBlock` — used for `toggleBoardSection`/`applyBoardSectionState`
      per the precedent in `docs/superpowers/plans/2026-07-16-agents-sidebar-consolidation.md`
      Task 1). Using that same extraction convention, add two new tests:
  - `renderSessionEmpty()`: given a fake `state`/DOM with nothing selected and no panel open, a
    `#session` element ends up containing `.session-empty` with the text
    `Select a task to inspect its session.`; given `state.selected` truthy (or any one of
    `state.selectedSkillOrCommand`/`_taskFormInSession`/`_flashState.panelOpen`/
    `_brainState.panelOpen`/`_rolesState.panelOpen`/`_toolsState.panelOpen`/
    `_goalsState.panelOpen`), the function returns without touching `#session`'s content.
  - `closeSession()`: given `state.selected`/`state.selectedSkillOrCommand` set and one panel-open
    flag true, after calling it: all of those are reset to null/false, `_skSel === ''`,
    `_ctxTask === null`, `setStoredView` was called with `''` (spy/stub it the same way existing
    tests stub `localStorage`), and `syncNav`/`renderBoard`/`renderSkillList`/`renderSessionEmpty`
    were all invoked (spy each, matching how `showOverview`'s existing call graph would be tested
    if it already had a test — it doesn't today, so this is new coverage, not a port).
  - **Verify these assertions against real extracted source once written — confirm they fail
    (RED) because `closeSession`/`renderSessionEmpty` don't exist yet**, not because of a typo in
    the test itself.
- [ ] Add both functions to `console.ts`, placed immediately next to the existing
      `renderOverview()`/`showOverview()` they will eventually replace (so Task 2's diff is a
      clean swap, not a relocation):

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

  // Closes whatever's open (task, skill/command detail, New Task form, any of the
  // 5 panels) and returns the center pane to its idle state. Replaces
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

- [ ] Re-run the two new tests. Confirm **GREEN**. Run the full `console.test.ts` suite — confirm
      no regressions (there should be none; nothing existing calls the new functions yet).

## Task 2 — migrate every caller, delete every Overview-exclusive piece, update every test it breaks

This is the one atomic breaking change: production callers and their tests move together so the
suite is never red at rest.

- [ ] **RED first** — update the tests below to assert the *post-removal* state, run them, confirm
      they fail against the current (pre-Task-2) code:
  - `console.test.ts:1355-1359` ("center column shows an overview when no task is selected") and
    `1361-1367` ("overview renders server-driven pack dashboard cards") — replace both with one
    test: center column shows `.session-empty` (not `.overview`/`.ov-grid`) when nothing is
    selected; assert `packCards`/`/packs/dashboard-cards` are **not** fetched by `refresh()`
    anymore (grep the test file's existing mock-fetch assertion style and mirror it — don't
    invent a new mocking approach).
  - `console.test.ts:1667-1675` ("board column has an Overview nav above + New task") — invert to
    assert `id="overviewNav"` does **not** appear in `CONSOLE_HTML`, and `＋ New task` is still the
    first button inside `<section class="col board">`.
  - `console.test.ts:1677-1685` ("showOverview clears the selected task and renders the overview")
    — replace with the `closeSession()` equivalent (this may already be covered by Task 1's new
    test; if so, delete this one instead of replacing it — don't duplicate coverage).
  - `console.test.ts:1687-1693` ("task detail renders a Back to overview action") — update to
    assert the task-detail back-link says `← Back` and calls `closeSession()`, not
    `← Overview`/`showOverview()`.
  - `console.test.ts:1695` + body ("Escape returns to Overview only outside editable fields") —
    update the assertion to expect `closeSession()` is called (same guard conditions: not an
    editable target, no open modal — those don't change).
  - `console.test.ts:1021,1105,1111,2758-2766` — these are shared tests (nav-sync,
    Roles-panel mutual exclusivity, primary-nav active-color convention) that each contain one or
    two incidental `overviewNav`/`overviewActive`/`"showOverview"` references. Drop just those
    references (e.g. the `"showOverview"` entry in the function-name array at `1111`; the
    `overviewNav`/`overviewActive` keys at `1021,1105,2758-2766`) — do not delete these tests,
    they cover unrelated shared behavior.
  - `console.test.ts:2906-2910` (Tools-panel search-alignment test) — it locates the toolbar
    position using the literal text `← Overview` as an anchor. Update the anchor to `← Back`.
  - `scripts/console-overview-colors.test.mjs:23-26` ("card() passes numColor to ov-num element")
    — delete this test (the `card()` helper and `.ov-num` element it covers are being deleted).
    Leave the other 4 tests in this file untouched (3 `laneColor` tests + 1 wallpaper test are
    unrelated to Overview despite the file name).
  - `scripts/console-scheduled-rename.test.mjs:31-40` ("overview card label is scheduled not
    active directives") — delete this test (the card it covers is being deleted). Leave the other
    4 tests in this file untouched.
  - Confirm all of the above are **RED** (failing) before touching production code, for the ones
    that assert new/changed behavior. (The pure-deletion test removals have no RED state of their
    own — that's expected, just remove them alongside the production deletion.)
- [ ] **Delete** the following from `console.ts` (confirm current line numbers against live source
      first — Task 1 added ~35 lines above some of these, so numbers below are pre-Task-1 citations
      from design-time HEAD `c91da580`, not authoritative):
  - `.overview`, `.ov-head`, `.ov-grid`, `.ov-card`/`.ov-card[onclick]`/`.ov-card.warn/.ok/.err`,
    `.ov-num`, `.ov-lbl`, `.ov-hint` CSS rules (search for `/* Center overview` comment,
    originally `console.ts:294-304,312-313` — **do not** delete `.ov-nav`/`.ov-back`, they're
    shared with every other sidebar nav button and back-link).
  - The `#overviewNav` button element (search for `id="overviewNav"`, originally
    `console.ts:1819`) — delete the whole `<button>` line.
  - `packMetricLabel()` (originally `console.ts:2047-2053`).
  - `renderPackDashboardCards()` (originally `console.ts:2055-2069`).
  - `renderOverview()` (originally `console.ts:2083-2105` — the old function; keep the new
    `renderSessionEmpty()` from Task 1).
  - `showOverview()` (originally `console.ts:2109-2126` — the old function; keep the new
    `closeSession()` from Task 1).
  - `focusBoardLane()` (originally `console.ts:2127-2132`).
  - `updateOverviewNav()` (originally `console.ts:2158`, the one-line `syncNav()` wrapper).
  - The `/packs/dashboard-cards` fetch and `state.packCards` assignment inside `refresh()`
    (originally `console.ts:5731-5732,5736` — remove `packCards` from the `Promise.all` array and
    its destructured name, and remove the `state.packCards = ...` line. **Do not touch the backend
    route** `server.ts:3072-3076`/`getPackDashboardCards()` — see design doc Non-goals).
- [ ] **Update** `syncNav()` (search for `const overviewActive =`, originally `console.ts:2140`) —
      delete the `overviewActive` line and the `overviewNav: overviewActive,` entry from the
      `active` object. Update the function's leading comment (originally `console.ts:2134-2138`,
      mentions "showOverview synced nothing") to drop the now-inaccurate historical reference.
- [ ] **Update** `renderBoard()`'s nav-sync call site (search for the lone `updateOverviewNav();`
      statement, originally `console.ts:2532`) — replace with `syncNav();` (the wrapper is
      deleted, but this call must survive: it's the only nav-sync triggered after every board
      re-render).
- [ ] **Migrate every caller** from the old names to the new ones:
  - `deleteTask()` (search for `renderOverview();` following `state.selected = null;`, originally
    `console.ts:2794`) — `renderOverview()` → `renderSessionEmpty()`.
  - `_closeSkillPanel()` (search for its trailing `renderOverview();`, originally
    `console.ts:3870`) — `renderOverview()` → `renderSessionEmpty()`.
  - `refresh()`'s idle branch (search for `else renderOverview();`, originally `console.ts:5742`)
    — → `else renderSessionEmpty();`.
  - The Escape-key handler (search for the standalone `showOverview();` statement inside the
    `keydown` listener, originally `console.ts:6574`) — → `closeSession();`. Update the handler's
    leading comment (originally `console.ts:6567-6568`, "Escape returns to the Overview...") to
    describe closing the open task/panel instead.
- [ ] **Update the 10 back-link buttons.** Confirm the exact current text first (`grep -n
      'ov-back' src/daemon/console.ts`) — as of design time these were char-for-char identical
      across groups, enabling 3 `replace_all` edits instead of 10 individual ones:
  1. 7 sites with the full title attribute (originally lines `2764,3373,6039,7022,7140,7665,7898`)
     share the exact substring
     `onclick="showOverview()" title="Back to overview (Esc)">← Overview<` — replace **all**
     occurrences with `onclick="closeSession()" title="Back (Esc)">← Back<`.
  2. 1 site with no title attribute (originally line `7802`, the Tools-panel error state) has the
     substring `onclick="showOverview()">← Overview<` — replace with
     `onclick="closeSession()">← Back<`.
  3. 2 sites that call `_closeSkillPanel()` instead of `showOverview()` (originally lines
     `3889,3921`) share the substring
     `onclick="_closeSkillPanel()" title="Back to overview (Esc)">← Overview<` — replace **all**
     occurrences with `onclick="_closeSkillPanel()" title="Back (Esc)">← Back<` (handler
     unchanged, text only — `_closeSkillPanel()` itself was already updated above to call
     `renderSessionEmpty()`).
  - Verify via `grep -n 'ov-back\|showOverview\|← Overview' src/daemon/console.ts` afterward: the
    only remaining hits should be the `.ov-back`/`.ov-nav` CSS rule and `closeSession`/
    `_closeSkillPanel` definitions — zero occurrences of `showOverview` or `← Overview` anywhere.
- [ ] Re-run the full `console.test.ts` suite plus the two `scripts/*.test.mjs` files. Confirm
      **GREEN** — every test updated in the RED step above now passes, and nothing else regressed.

## Task 3 — view-persistence sentinel cleanup (independent of Task 2; safe to skip without regressions, but do it for correctness)

After Task 2, nothing ever sets `_currentView`/`hm_last_view` to `"overview"` again (that only
happened inside the old `showOverview()`, already replaced by `closeSession()` calling
`setStoredView('')`). `HM_VALID_VIEWS` still listing `"overview"` as a dead enum value and
`getStoredView()` still defaulting new users to the string `"overview"` (which
`restoreLastView()`'s existing no-op branch already handles harmlessly) is functionally correct
but stale. Clean it up:

- [ ] **RED** — update these tests to expect `""` instead of `"overview"`, confirm they fail
      against Task-2-state:
  - `console.test.ts:3036-3043` (`getStoredView()` default/fallback test) — expect `""`.
  - `console.test.ts:3289` (view-switching table-driven test, the
    `["showOverview", "overview"]` row) — delete this row entirely (no function maps to a view
    string anymore; this isn't a rename, the whole table entry goes).
  - `console.test.ts:3337-3339` (`restoreLastView` test: `run("overview")` and
    `run("garbage-value")` both expect `[]`) — change `run("overview")` to `run("")` (still
    expects `[]`; `"overview"` itself becomes just another garbage/unrecognized value once it's
    out of `HM_VALID_VIEWS`, so keep a case proving that too, e.g. rename the existing
    `run("garbage-value")` case's coverage note rather than deleting the garbage-value case).
  - `console.test.ts:3390-3391` (scroll-position test: `saveScrollPosition("overview")` no-ops) —
    change to `saveScrollPosition("")`. (No production change needed here — confirmed in the
    design doc that `saveScrollPosition`/`SCROLL_TARGETS` already no-op generically for any
    unrecognized key; this is purely updating the test's chosen input to match the new real
    sentinel.)
  - `console.test.ts:3424` (`restoreLastView` pending-scroll test: `run("overview")` expects
    `null`) — change to `run("")`.
- [ ] Update `console.ts` (search for `var HM_VALID_VIEWS`, originally `console.ts:2320-2327`):

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

  Update `restoreLastView()`'s trailing comment (originally `console.ts:3286`, "'overview' is
  already the default rendered state on boot — nothing to do.") to instead note that an empty/
  unrecognized stored view is the no-op idle default — including a legacy `"overview"` string
  left over in a returning user's `localStorage` from before this change, which
  `HM_VALID_VIEWS.indexOf` already turns into `""` on its own (no migration code needed).
- [ ] Re-run the updated tests. Confirm **GREEN**. Run the full suite once more.

## Verification gates (run after Task 3, before declaring done)

- [ ] `npm run typecheck` — zero errors (expected no-op for this change: the edited code is all
      inside the `CONSOLE_HTML` template-literal string, which typecheck doesn't parse — this gate
      exists to catch anything unexpected, e.g. an accidentally-unbalanced template literal).
- [ ] `npm test` — full suite passes, no regressions beyond any pre-existing known skip.
- [ ] `node scripts/scope-wall.mjs` — zero violations (expected no-op: no new persistent
      store/concept/brand introduced; this change only removes one).

## Finishing

- [ ] `git status` / `git diff` — confirm **only** `src/daemon/console.ts`,
      `src/daemon/console.test.ts`, `scripts/console-overview-colors.test.mjs`,
      `scripts/console-scheduled-rename.test.mjs` changed (plus these two doc files). If other
      files show as modified, they belong to unrelated work that landed after this plan was
      authored — do not stage or commit them.
- [ ] Stage only those 6 files by name — never `git add -A` / `git add .`.
- [ ] Commit to `main`: `Remove redundant Overview section (data now in left sidebar)`.
- [ ] Push to `origin main` — explicit dispatch instruction.
- [ ] Do **not** build, release, notarize, or publish anything, and do not invoke
      `developer-id-release`/`release-hivematrix` — the operator releases, per this dispatch's
      explicit instruction ("No build at this time" / "Do NOT release; the operator releases").
- [ ] Append a dated entry to `~/_GD/brain/projects/hive/known-issues.md` recording the shipped
      commit SHA and a one-line description (Overview section removed; idle state is now the
      plain empty placeholder; `/packs/dashboard-cards` backend endpoint kept alive for the
      companion-app consumer even though the console no longer renders it).
