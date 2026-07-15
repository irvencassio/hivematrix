# Window State Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status as of 2026-07-15 (commit pending):** Tasks 1 and 2 are implemented,
> tested, and independently re-verified (not just trusted from the
> implementing subagents' self-reports) — window position/size now persists
> via `tauri-plugin-window-state`, and the active sidebar view now persists
> and restores via `hm_last_view`. **Task 3 (scroll position) was deliberately
> NOT implemented in this pass** — this dispatch hit its `--max-budget-usd 10`
> ceiling after Task 2 (which cost more than planned: it caught and fixed a
> real bug in this plan's original 2a test code, see the commit/diff for
> details) before Task 3 could be safely attempted end-to-end. Task 3 below
> is fully speced with exact code for all four sub-parts (3a-3d) and needs no
> further design work — a follow-up dispatch (or the operator) can execute it
> directly. **Active conversation restoration needed no code** (design
> decision #4) — already covered for free once Task 2's view restoration
> calls `showFlashPanel()`, which already re-fetches the one true "current"
> session. Do not re-run Tasks 1/2 — check `git log` for the commit first.

Design doc: `docs/superpowers/specs/2026-07-15-window-state-restoration-design.md`.
Read it first — this plan assumes its design decisions (esp. #2-#4) without
re-justifying them.

Task order: **1 and 2 are independent (may run in parallel). 3 depends on 2**
(it modifies `restoreLastView()`, which Task 2 creates).

---

## Task 1 — Rust: window position/size via `tauri-plugin-window-state`

- [ ] `cd src-tauri && cargo add tauri-plugin-window-state` — adds a correctly
      resolved current 2.x version to `Cargo.toml` (do not hand-type a version
      string; let `cargo add` resolve it against the registry).
- [ ] In `src-tauri/src/lib.rs`, inside `pub fn run()` (~line 466), add the plugin
      registration alongside the existing sibling plugins, e.g.:

  ```rust
  tauri::Builder::default()
      .plugin(tauri_plugin_window_state::Builder::default().build())
      .plugin(tauri_plugin_updater::Builder::new().build())
      .plugin(tauri_plugin_process::init())
      .plugin(tauri_plugin_deep_link::init())
      .manage(DaemonChild(Mutex::new(None)))
      // ...unchanged from here
  ```

  Exact position among the four `.plugin(...)` calls doesn't matter (no
  inter-plugin ordering dependency here) — keep them grouped together for
  readability. Use plugin defaults — no `.with_state_flags(...)` call (see
  design doc decision #1: unused customization is unrequested complexity).

- [ ] **No RED/GREEN test cycle for this task.** Plugin registration is
      declarative wiring with no pure logic to unit-test — the same reason
      the three sibling plugins already in this file (`updater`/`process`/
      `deep-link`) have zero dedicated tests; only pure helper functions in
      this file (e.g. `is_replaceable_hivematrix_daemon_command`) get
      `#[cfg(test)]` coverage. This is a documented exception (see design
      doc "Current state"), not a corner cut — don't invent a test just to
      satisfy the letter of TDD where there's nothing pure to test.
- [ ] Verify instead by compiling: `cd src-tauri && cargo check`. Confirm zero
      errors. Then `cargo build` (release or debug, either proves the crate
      links) to confirm it's not just a syntax-level check.
- [ ] `cd src-tauri && cargo test` — confirm the existing 3 tests in
      `lib.rs`'s `#[cfg(test)] mod tests` still pass (regression check; this
      change shouldn't touch them, but confirm rather than assume).

## Task 2 — JS: persist and restore the active sidebar view

All edits in `src/daemon/console.ts` / `src/daemon/console.test.ts`. Follow
the `extractFunctionBlock(js, "name")` + `new Function(...)` + mocked-globals
pattern already established in `console.test.ts` (worked examples at
`console.test.ts:681-726` and `:739-750`) for every behavioral test below.

### 2a — `getStoredView` / `setStoredView`

- [ ] **RED.** Add to `console.test.ts` (near the other localStorage-backed
      feature tests):

  ```ts
  test("getStoredView / setStoredView round-trip through localStorage, with a valid-view fallback", () => {
    const js = extractScript(CONSOLE_HTML);
    const validViewsSrc = js.match(/var HM_VALID_VIEWS = \[[^\]]*\];/);
    assert.ok(validViewsSrc, "console script must define HM_VALID_VIEWS");
    const getSrc = extractFunctionBlock(js, "getStoredView");
    const setSrc = extractFunctionBlock(js, "setStoredView");

    function makeStore() {
      const backing: Record<string, string> = {};
      return {
        localStorage: {
          getItem: (k: string) => (k in backing ? backing[k] : null),
          setItem: (k: string, v: string) => { backing[k] = v; },
        },
        backing,
      };
    }

    const factory = new Function(
      "localStorage",
      `${validViewsSrc![0]}\n${getSrc}\n${setSrc}\nreturn { getStoredView, setStoredView };`,
    ) as (ls: unknown) => { getStoredView: () => string; setStoredView: (v: string) => void };

    const { localStorage: ls, backing } = makeStore();
    const { getStoredView, setStoredView } = factory(ls);

    assert.equal(getStoredView(), "overview", "no stored value yet -> defaults to overview");
    setStoredView("roles");
    assert.equal(backing["hm_last_view"], "roles");
    assert.equal(getStoredView(), "roles");

    backing["hm_last_view"] = "not-a-real-view";
    assert.equal(getStoredView(), "overview", "garbage stored value falls back to overview");
  });
  ```

  Run `npm test -- --test-name-pattern="getStoredView"`. Confirm it **fails**
  (the functions/var don't exist yet) — actually read the failure, don't just
  assume.

- [ ] **GREEN.** In `console.ts`, immediately above `function getCollapsedLanes()`
      (~line 2278), add:

  ```js
  // Active view persistence — restores the last-open sidebar view on launch.
  var HM_VIEW_KEY = "hm_last_view";
  var HM_VALID_VIEWS = ["overview", "flash", "brain", "roles", "tools", "goals"];
  var _currentView = "overview";

  function getStoredView() {
    try {
      var v = localStorage.getItem(HM_VIEW_KEY);
      return HM_VALID_VIEWS.indexOf(v) !== -1 ? v : "overview";
    } catch (e) { return "overview"; }
  }

  function setStoredView(view) {
    _currentView = view;
    try { localStorage.setItem(HM_VIEW_KEY, view); } catch (e) { /* ignore */ }
  }
  ```

  Re-run the same test filter. Confirm **GREEN**.

### 2b — wire `setStoredView` into all six view-switching functions

- [ ] **RED.** Add:

  ```ts
  test("every view-switching function records itself as the last-active view", () => {
    const js = extractScript(CONSOLE_HTML);
    const cases: [string, string][] = [
      ["showOverview", "overview"],
      ["showFlashPanel", "flash"],
      ["showBrain", "brain"],
      ["showRoles", "roles"],
      ["showTools", "tools"],
      ["showGoals", "goals"],
    ];
    for (const [fn, view] of cases) {
      const src = extractFunctionBlock(js, fn);
      assert.match(
        src,
        new RegExp(`setStoredView\\(['"]${view}['"]\\)`),
        `${fn} must call setStoredView('${view}')`,
      );
    }
  });
  ```

  Confirm **RED** (none of the six functions call `setStoredView` yet).

- [ ] **GREEN.** In each of the six functions, add one line —
      `setStoredView('<view>');` — immediately after that function's last
      `_goalsState.panelOpen = ...;` line (every one of the six ends its
      panel-open block with a `_goalsState.panelOpen` assignment; use it as
      the anchor):
  - `showOverview()` (~2093): after `_goalsState.panelOpen = false;` → `setStoredView('overview');`
  - `showFlashPanel()` (~6808): after `_goalsState.panelOpen = false;` → `setStoredView('flash');`
  - `showBrain()` (~6937): after `_goalsState.panelOpen = false;` → `setStoredView('brain');`
  - `showRoles()` (~7456): after `_goalsState.panelOpen = false;` → `setStoredView('roles');`
  - `showTools()` (~7486): after `_goalsState.panelOpen = false;` → `setStoredView('tools');`
  - `showGoals()` (~3052): after `_goalsState.panelOpen = true;` → `setStoredView('goals');`

  (Line numbers are as of this plan's writing — locate each function by name
  and its `_goalsState.panelOpen` line, don't trust the numbers blindly if
  Task 1/prior edits shifted them.) Re-run the test filter. Confirm **GREEN**.
  Also run the full `getStoredView`/`setStoredView` test from 2a again —
  confirm still green (no interference).

### 2c — `restoreLastView()` dispatcher

- [ ] **RED.** Add:

  ```ts
  test("restoreLastView dispatches to the show function matching the stored view", () => {
    const js = extractScript(CONSOLE_HTML);
    const getStoredViewSrc = extractFunctionBlock(js, "getStoredView");
    const validViewsSrc = js.match(/var HM_VALID_VIEWS = \[[^\]]*\];/);
    assert.ok(validViewsSrc);
    const restoreSrc = extractFunctionBlock(js, "restoreLastView");

    function run(storedView: string) {
      const calls: string[] = [];
      const factory = new Function(
        "localStorage",
        "showFlashPanel", "showBrain", "showRoles", "showTools", "showGoals",
        `${validViewsSrc![0]}\n${getStoredViewSrc}\n${restoreSrc}\nreturn restoreLastView;`,
      ) as (
        ls: unknown, f: () => void, b: () => void, r: () => void, t: () => void, g: () => void,
      ) => () => void;
      const ls = { getItem: () => storedView };
      const restoreLastView = factory(
        ls,
        () => calls.push("flash"), () => calls.push("brain"), () => calls.push("roles"),
        () => calls.push("tools"), () => calls.push("goals"),
      );
      restoreLastView();
      return calls;
    }

    assert.deepEqual(run("flash"), ["flash"]);
    assert.deepEqual(run("brain"), ["brain"]);
    assert.deepEqual(run("roles"), ["roles"]);
    assert.deepEqual(run("tools"), ["tools"]);
    assert.deepEqual(run("goals"), ["goals"]);
    assert.deepEqual(run("overview"), [], "overview is already the default render — no show* call needed");
    assert.deepEqual(run("garbage-value"), [], "unknown stored values fall back to overview (no-op)");
  });
  ```

  Confirm **RED** (`restoreLastView` doesn't exist yet).

- [ ] **GREEN.** Add, near the other `show*` functions (e.g. directly after
      `showGoals()`):

  ```js
  function restoreLastView() {
    var view = getStoredView();
    if (view === 'flash') showFlashPanel();
    else if (view === 'brain') showBrain();
    else if (view === 'roles') showRoles();
    else if (view === 'tools') showTools();
    else if (view === 'goals') showGoals();
    // 'overview' is already the default rendered state on boot — nothing to do.
  }
  ```

  Confirm **GREEN**.

### 2d — wire `restoreLastView()` into boot

- [ ] **RED.** Add:

  ```ts
  test("boot sequence restores the last-active view after refresh()", () => {
    const js = extractScript(CONSOLE_HTML);
    const bootIx = js.indexOf("if (requireToken()) {");
    assert.notEqual(bootIx, -1, "boot gate must exist");
    const bootBlock = js.slice(bootIx);
    const refreshIx = bootBlock.indexOf("refresh();");
    const restoreIx = bootBlock.indexOf("restoreLastView();");
    assert.notEqual(refreshIx, -1);
    assert.notEqual(restoreIx, -1, "boot sequence must call restoreLastView()");
    assert.ok(restoreIx > refreshIx, "restoreLastView() must run after refresh() so board/task state is loaded first");
  });
  ```

  Confirm **RED**.

- [ ] **GREEN.** In the boot block (~line 9718-9738), add `restoreLastView();`
      right after `refresh();`:

  ```js
  loadProjects();
  refresh();
  restoreLastView();
  connectSSE();
  ```

  Confirm **GREEN**. Then run the **full** `npm test` once for this task —
  confirm no regressions before moving to Task 3.

---

## Task 3 — JS: scroll position for Chat/Tools/Goals (depends on Task 2)

Design doc decision #3: only Chat (`#flashTranscript`), Tools and Goals
(`.tools-pane`) get scroll restoration — Roles (3 ambiguous sub-panes) and
Overview/Board (generic shared `.col`, low value) are explicitly excluded.

**Important, verified while writing this plan (do not re-derive):**
`flashRenderMessages()` is called exactly once per Chat restore (only from
inside `hydrateFlashThread()`, after data arrives — never called synchronously
by `showFlashPanel()` itself). But `renderToolsPanel()` / `renderGoalsPanel()`
are each called **twice** in the restore flow: once synchronously from
`showTools()`/`showGoals()` with a loading placeholder (`_toolsState.groups`/
`_goalsState.goals` still `null`), and again from `loadCapabilities()`/
`loadGoals()` once real data arrives (each of those two functions calls its
render function exactly once, at its own tail, in both the success and
`catch` paths — confirmed via `grep -n return` inside both render functions:
`renderToolsPanel` has an early `return` after its error branch at line 7535,
`renderGoalsPanel` has no such branch and always falls through). Hooking the
one-shot restore into the render functions directly would consume it on the
empty placeholder pass. **Hook `loadCapabilities()` and `loadGoals()`
instead of `renderToolsPanel()`/`renderGoalsPanel()`** — each already calls
its render function exactly once, after real state is set, in both the
try and catch paths.

### 3a — `SCROLL_TARGETS`, `saveScrollPosition`, `restoreScrollPosition`

- [ ] **RED.** Add:

  ```ts
  test("saveScrollPosition / restoreScrollPosition read and write scrollTop for known views, no-op for unmapped ones", () => {
    const js = extractScript(CONSOLE_HTML);
    const targetsSrc = js.match(/var SCROLL_TARGETS = \{[^}]*\};/);
    assert.ok(targetsSrc, "console script must define SCROLL_TARGETS");
    const keySrc = extractFunctionBlock(js, "scrollStorageKey");
    const saveSrc = extractFunctionBlock(js, "saveScrollPosition");
    const restoreSrc = extractFunctionBlock(js, "restoreScrollPosition");

    function makeEnv(scrollTop: number) {
      const backing: Record<string, string> = {};
      const el = { scrollTop };
      return {
        document: { querySelector: (sel: string) => (sel === "#flashTranscript" ? el : null) },
        localStorage: {
          getItem: (k: string) => (k in backing ? backing[k] : null),
          setItem: (k: string, v: string) => { backing[k] = v; },
        },
        backing,
        el,
      };
    }

    const factory = new Function(
      "document", "localStorage",
      `${targetsSrc![0]}\n${keySrc}\n${saveSrc}\n${restoreSrc}\nreturn { saveScrollPosition, restoreScrollPosition };`,
    ) as (doc: unknown, ls: unknown) => { saveScrollPosition: (v: string) => void; restoreScrollPosition: (v: string) => void };

    const env = makeEnv(240);
    const { saveScrollPosition, restoreScrollPosition } = factory(env.document, env.localStorage);

    saveScrollPosition("flash");
    assert.equal(env.backing["hm_scroll_flash"], "240");

    saveScrollPosition("overview"); // not in SCROLL_TARGETS — no-op, must not throw
    assert.equal(env.backing["hm_scroll_overview"], undefined);

    env.el.scrollTop = 0;
    restoreScrollPosition("flash");
    assert.equal(env.el.scrollTop, 240, "restore should apply the previously saved value");

    restoreScrollPosition("roles"); // no target element registered for roles — no-op, must not throw
  });
  ```

  Confirm **RED**.

- [ ] **GREEN.** Add, directly below the `setStoredView` function from Task 2a:

  ```js
  // Scroll position persistence — only for views with one unambiguous
  // scrollable content container (see design doc decision #3).
  var SCROLL_TARGETS = { flash: '#flashTranscript', tools: '.tools-pane', goals: '.tools-pane' };
  var _pendingScrollRestore = null;

  function scrollStorageKey(view) { return 'hm_scroll_' + view; }

  function saveScrollPosition(view) {
    var sel = SCROLL_TARGETS[view];
    if (!sel) return;
    var el = document.querySelector(sel);
    if (!el) return;
    try { localStorage.setItem(scrollStorageKey(view), String(el.scrollTop)); } catch (e) { /* ignore */ }
  }

  function restoreScrollPosition(view) {
    var sel = SCROLL_TARGETS[view];
    if (!sel) return;
    var el = document.querySelector(sel);
    if (!el) return;
    var saved = 0;
    try { saved = parseInt(localStorage.getItem(scrollStorageKey(view)) || '0', 10) || 0; } catch (e) { /* ignore */ }
    el.scrollTop = saved;
  }
  ```

  Confirm **GREEN**.

### 3b — `restoreLastView()` sets the pending flag for scroll-tracked views

- [ ] **RED.** Add:

  ```ts
  test("restoreLastView marks a pending scroll restore only for scroll-tracked views", () => {
    const js = extractScript(CONSOLE_HTML);
    const validViewsSrc = js.match(/var HM_VALID_VIEWS = \[[^\]]*\];/);
    const getStoredViewSrc = extractFunctionBlock(js, "getStoredView");
    const restoreSrc = extractFunctionBlock(js, "restoreLastView");

    function run(storedView: string) {
      const factory = new Function(
        "localStorage",
        "showFlashPanel", "showBrain", "showRoles", "showTools", "showGoals",
        `var _pendingScrollRestore = null;\n${validViewsSrc![0]}\n${getStoredViewSrc}\n${restoreSrc}\nreturn { restoreLastView: restoreLastView, getPending: function () { return _pendingScrollRestore; } };`,
      ) as (
        ls: unknown, f: () => void, b: () => void, r: () => void, t: () => void, g: () => void,
      ) => { restoreLastView: () => void; getPending: () => string | null };
      const api = factory({ getItem: () => storedView }, () => {}, () => {}, () => {}, () => {}, () => {});
      api.restoreLastView();
      return api.getPending();
    }

    assert.equal(run("flash"), "flash");
    assert.equal(run("tools"), "tools");
    assert.equal(run("goals"), "goals");
    assert.equal(run("brain"), null, "brain has no scroll target — must not be marked pending");
    assert.equal(run("roles"), null, "roles has no scroll target — must not be marked pending");
    assert.equal(run("overview"), null);
  });
  ```

  Confirm **RED**.

- [ ] **GREEN.** Modify `restoreLastView()` (from Task 2c) to:

  ```js
  function restoreLastView() {
    var view = getStoredView();
    if (view === 'flash') { _pendingScrollRestore = 'flash'; showFlashPanel(); }
    else if (view === 'brain') showBrain();
    else if (view === 'roles') showRoles();
    else if (view === 'tools') { _pendingScrollRestore = 'tools'; showTools(); }
    else if (view === 'goals') { _pendingScrollRestore = 'goals'; showGoals(); }
    // 'overview' is already the default rendered state on boot — nothing to do.
  }
  ```

  Confirm **GREEN**. Re-run Task 2c's dispatch test too — confirm still green.

### 3c — consume the pending flag once real content has rendered

- [ ] **RED.** Add three source-presence assertions (behavioral extraction
      isn't practical here without mocking the full async `api()`/network
      surface each of these three functions pulls in — matching this file's
      documented lighter-weight style for such cases, same as the boot-wiring
      test in 2d):

  ```ts
  test("Chat/Tools/Goals consume the pending scroll restore exactly once real content is rendered", () => {
    const js = extractScript(CONSOLE_HTML);
    const flashSrc = extractFunctionBlock(js, "flashRenderMessages");
    assert.match(flashSrc, /_pendingScrollRestore === 'flash'/, "flashRenderMessages must consume a pending 'flash' scroll restore");
    assert.match(flashSrc, /restoreScrollPosition\('flash'\)/);

    const loadCapsSrc = extractFunctionBlock(js, "loadCapabilities");
    assert.match(loadCapsSrc, /_pendingScrollRestore === 'tools'/, "loadCapabilities (not renderToolsPanel) must consume a pending 'tools' scroll restore — it's the single call site reached exactly once with real data, in both success and error paths");
    assert.match(loadCapsSrc, /restoreScrollPosition\('tools'\)/);

    const loadGoalsSrc = extractFunctionBlock(js, "loadGoals");
    assert.match(loadGoalsSrc, /_pendingScrollRestore === 'goals'/, "loadGoals (not renderGoalsPanel) must consume a pending 'goals' scroll restore");
    assert.match(loadGoalsSrc, /restoreScrollPosition\('goals'\)/);
  });
  ```

  Confirm **RED**.

- [ ] **GREEN.** In `flashRenderMessages()` (~line 7874-7910ish), add as the
      last statement before the function's closing `}` (after its
      `el.innerHTML = ...` assignment completes):

  ```js
    if (_pendingScrollRestore === 'flash') { _pendingScrollRestore = null; restoreScrollPosition('flash'); }
  ```

  In `loadCapabilities()` (~line 7500-7510), add as the last statement, after
  its existing `renderToolsPanel();` call:

  ```js
  async function loadCapabilities() {
    _toolsState.error = false;
    try {
      const r = await api('/capabilities');
      _toolsState.groups = (r && r.groups) || [];
    } catch (e) {
      _toolsState.error = true;
      _toolsState.groups = null;
    }
    renderToolsPanel();
    if (_pendingScrollRestore === 'tools') { _pendingScrollRestore = null; restoreScrollPosition('tools'); }
  }
  ```

  In `loadGoals()` (~line 3066-3076), same shape, after its existing
  `renderGoalsPanel();` call:

  ```js
  async function loadGoals() {
    _goalsState.error = false;
    try {
      const r = await api('/goals');
      _goalsState.goals = (r && r.goals) || [];
    } catch (e) {
      _goalsState.error = true;
      _goalsState.goals = null;
    }
    renderGoalsPanel();
    if (_pendingScrollRestore === 'goals') { _pendingScrollRestore = null; restoreScrollPosition('goals'); }
  }
  ```

  Confirm **GREEN**.

### 3d — periodic scroll save piggybacked on the existing 5s refresh

- [ ] **RED.** Add:

  ```ts
  test("refresh() saves the current view's scroll position on every tick", () => {
    const js = extractScript(CONSOLE_HTML);
    const refreshSrc = extractFunctionBlock(js, "refresh");
    assert.match(refreshSrc, /saveScrollPosition\(_currentView\)/, "refresh() must piggyback a scroll-position save on its existing 5s poll cadence, not add a new timer");
  });
  ```

  Confirm **RED**.

- [ ] **GREEN.** In `refresh()` (~line 5474-5503), add
      `saveScrollPosition(_currentView);` — placement anywhere inside the
      function body is fine (it doesn't depend on ordering relative to the
      other calls); simplest is right after the `renderApprovals();
      renderSkillCatalog(); renderMcp();` line, still inside the `try` block:

  ```js
    renderConn(); renderDirectives(); renderMetrics(); renderOnboarding();
    renderApprovals(); renderSkillCatalog(); renderMcp();
    saveScrollPosition(_currentView);
  } catch (e) { _httpHealthy = false; /* transient */ }
  ```

  Confirm **GREEN**. Run the **full** `npm test` — confirm no regressions.

---

## Verification gates (run after all tasks, before declaring done)

1. `npm run typecheck` — zero errors
2. `npm test` — full suite passes (record pass count; compare to the
   pre-change baseline to confirm no regressions, not just "green")
3. `node scripts/scope-wall.mjs` — zero violations (expected no-op: no new
   persistent store or product concept — see design doc's DECISIONS.md
   reasoning)
4. `cd src-tauri && cargo check && cargo test` — zero errors, existing 3
   tests still pass

Local-model gate (`qwen-readiness.mts`) does not apply — nothing here touches
`src/lib/local-model/`, `qwen-profile.ts`, or `backends.ts`.

## Finishing

- [ ] `git status` / `git diff` — confirm only the expected files changed:
      `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/src/lib.rs`,
      `src/daemon/console.ts`, `src/daemon/console.test.ts`, plus this plan
      and the design doc. Nothing stray.
- [ ] Commit to `main` with a descriptive message. **Do not push** (leave
      ahead of `origin/main` for the operator to push+release together,
      matching same-day precedent). **Do not run any release/build/notarize/
      publish skill or script** — release is operator-only.
- [ ] Record a short entry in `~/_GD/brain/projects/hive/known-issues.md` (or
      wherever this loop's dispatcher-facing brain doc lives) noting this
      shipped in commit `<sha>`, unreleased — so a future dispatch that
      re-reports "window position/view isn't remembered on relaunch" checks
      the running app version first instead of redoing this work. Follow the
      existing entries' style (see the `3adf9120`/`92856f1b` RESOLVED entries
      already in that file).
