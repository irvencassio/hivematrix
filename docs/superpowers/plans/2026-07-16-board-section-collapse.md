# Board Section Collapse/Expand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-07-16-board-section-collapse-design.md`
(Approach C — a new `.board-sec.collapsed` class on `#boardSec` + a new
`hm_board_collapsed` localStorage key, structurally mirroring `toggleContext`/
`applyCtxState` but scoped to the Board section instead of `<main>`.)

## Task 1 — failing tests, then implement, then verify

- [ ] In `src/daemon/console.test.ts`, add two new tests near the other
      board/localStorage-preference tests (e.g. after the
      `"getStoredView / setStoredView round-trip..."` test, ~line 3019, or any
      convenient spot after `extractFunctionBlock`/`fnBody` are already defined —
      both helpers are declared near the top of the file):

  ```ts
  test("toggleBoardSection / applyBoardSectionState round-trip through localStorage['hm_board_collapsed']", () => {
    const js = extractScript(CONSOLE_HTML);
    const toggleSrc = extractFunctionBlock(js, "toggleBoardSection");
    const applySrc = extractFunctionBlock(js, "applyBoardSectionState");

    // Confirm this doesn't reuse/touch the unrelated right-panel mechanism.
    assert.doesNotMatch(toggleSrc, /ctx-collapsed|querySelector\('main'\)/, "must not touch the <main> ctx-collapsed grid logic");

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

    function makeSecAndBtn() {
      const classes = new Set<string>();
      const sec = {
        classList: {
          toggle: (name: string) => { if (classes.has(name)) { classes.delete(name); return false; } classes.add(name); return true; },
          add: (name: string) => { classes.add(name); },
          contains: (name: string) => classes.has(name),
        },
      };
      const btn = { textContent: "▾", title: "Collapse Board" };
      return { sec, btn, classes };
    }

    function run(sec: unknown, btn: unknown, ls: unknown) {
      const factory = new Function(
        "localStorage", "__sec", "__btn",
        `const document = { getElementById: (id) => id === 'boardSec' ? __sec : (id === 'boardToggle' ? __btn : null) };\n`
          + `${toggleSrc}\n${applySrc}\nreturn { toggleBoardSection, applyBoardSectionState };`,
      ) as (ls: unknown, sec: unknown, btn: unknown) => { toggleBoardSection: () => void; applyBoardSectionState: () => void };
      return factory(ls, sec, btn);
    }

    // No stored preference yet: restoring must be a no-op (stays expanded, default glyph).
    const { localStorage: ls1, backing: backing1 } = makeStore();
    const { sec: sec1, btn: btn1 } = makeSecAndBtn();
    const { applyBoardSectionState: apply1 } = run(sec1, btn1, ls1);
    apply1();
    assert.equal(sec1.classList.contains("collapsed"), false, "nothing stored -> stays expanded");
    assert.equal(btn1.textContent, "▾", "nothing stored -> caret stays at its default glyph");

    // Toggle collapses, flips the caret, and persists "1".
    const { toggleBoardSection: toggle1 } = run(sec1, btn1, ls1);
    toggle1();
    assert.equal(sec1.classList.contains("collapsed"), true);
    assert.equal(btn1.textContent, "▸");
    assert.equal(backing1["hm_board_collapsed"], "1");

    // Toggle again expands, flips back, and persists "0".
    const { toggleBoardSection: toggle2 } = run(sec1, btn1, ls1);
    toggle2();
    assert.equal(sec1.classList.contains("collapsed"), false);
    assert.equal(btn1.textContent, "▾");
    assert.equal(backing1["hm_board_collapsed"], "0");

    // Fresh "reload" with "1" already persisted: a brand-new (default, expanded)
    // element must come up collapsed without any click.
    const { localStorage: ls2 } = makeStore();
    (ls2 as { setItem: (k: string, v: string) => void }).setItem("hm_board_collapsed", "1");
    const { sec: sec2, btn: btn2 } = makeSecAndBtn();
    const { applyBoardSectionState: apply2 } = run(sec2, btn2, ls2);
    apply2();
    assert.equal(sec2.classList.contains("collapsed"), true, "persisted collapsed state restores on load");
    assert.equal(btn2.textContent, "▸");
  });

  test("Board section collapse: toggle markup in board-sec-header, default expanded glyph, and the CSS rule that hides #board", () => {
    const html = CONSOLE_HTML;
    assert.match(
      html,
      /<div class="board-sec-header">Board <span id="boardToggle" class="board-toggle" onclick="toggleBoardSection\(\)"[^>]*>▾<\/span>/,
      "toggle span sits in the header, next to the heading text, defaulting to the expanded glyph",
    );
    const archiveIx = html.indexOf('id="archiveBtn"');
    const toggleIx = html.indexOf('id="boardToggle"');
    assert.ok(toggleIx !== -1 && archiveIx !== -1 && toggleIx < archiveIx, "toggle appears before the archive link, both inside the header row");
    assert.match(html, /\.board-sec\.collapsed #board \{ display: none; \}/, "collapsed class on #boardSec hides the lane container");
  });
  ```

- [ ] Run `npm test -- --test-name-pattern="Board section collapse|toggleBoardSection"`
      (or the project's equivalent single-file/single-test filter). Confirm both
      **fail** against the current source (`toggleBoardSection`/
      `applyBoardSectionState` don't exist yet, the markup/CSS aren't there yet).
      This is the RED step — actually observe the failure, don't skip it.

- [ ] In `src/daemon/console.ts`, change the markup at (confirm exact current line
      numbers first — cited as ~1882-1885, may have shifted):

  ```html
  <div id="boardSec" class="board-sec">
    <div class="board-sec-header">Board <span id="archiveBtn" class="archive-link" onclick="archiveCompleted()" title="Archive review/done/failed tasks"></span></div>
    <div id="board"></div>
  </div>
  ```

  to:

  ```html
  <div id="boardSec" class="board-sec">
    <div class="board-sec-header">Board <span id="boardToggle" class="board-toggle" onclick="toggleBoardSection()" title="Collapse Board">▾</span> <span id="archiveBtn" class="archive-link" onclick="archiveCompleted()" title="Archive review/done/failed tasks"></span></div>
    <div id="board"></div>
  </div>
  ```

- [ ] Add the CSS rule immediately after the existing `.board-sec-header` rule
      (~line 692):

  ```css
  .board-toggle { cursor: pointer; color: var(--muted); font-size: 11px; user-select: none; }
  .board-sec.collapsed #board { display: none; }
  ```

- [ ] Add the two JS functions next to `getCollapsedLanes`/`toggleBoardLane`
      (~line 2361, right before the `/*__REVIEW_SORT_COMPARATOR_START__*/` marker):

  ```js
  function toggleBoardSection() {
    const sec = document.getElementById('boardSec');
    if (!sec) return;
    const collapsed = sec.classList.toggle('collapsed');
    const btn = document.getElementById('boardToggle');
    if (btn) { btn.textContent = collapsed ? '▸' : '▾'; btn.title = collapsed ? 'Expand Board' : 'Collapse Board'; }
    try { localStorage.setItem('hm_board_collapsed', collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  // Restore the persisted collapse state on load. #boardSec/#boardToggle are static
  // markup (unlike #board's renderBoard()-generated innerHTML), so this only needs to
  // run once. Deliberately a named function + explicit call (not a bare IIFE like
  // applyCtxState) so it's unit-testable the same way toggleBoardSection is — a
  // one-line style deviation, not a behavior difference.
  function applyBoardSectionState() {
    try {
      if (localStorage.getItem('hm_board_collapsed') === '1') {
        const sec = document.getElementById('boardSec');
        if (sec) sec.classList.add('collapsed');
        const btn = document.getElementById('boardToggle');
        if (btn) { btn.textContent = '▸'; btn.title = 'Expand Board'; }
      }
    } catch (e) { /* ignore */ }
  }
  applyBoardSectionState();
  ```

- [ ] Re-run the same test filter. Confirm both **pass** (GREEN). No refactor step
      needed — this mirrors an existing pattern (`toggleContext`/`applyCtxState`)
      closely enough that there's no duplication to clean up.

## Verification gates (run after Task 1, before declaring done)

- [ ] `npm run typecheck` — zero errors
- [ ] `npm test` — full suite passes (not just the two new tests — confirm no
      regression, including the one known pre-existing skip)
- [ ] `node scripts/scope-wall.mjs` — zero violations (expected no-op: no new
      persistent store/concept, no brand/surface strings touched)

## Finishing

- [ ] `git status` / `git diff` — confirm only `src/daemon/console.ts` and
      `src/daemon/console.test.ts` changed (plus these two doc files), nothing
      stray swept in from unrelated in-flight work in this repo.
- [ ] Stage only those specific files (never `git add -A` / `git add .`).
- [ ] Commit to `main`: `Add collapse/expand toggle for Board section in left sidebar`.
- [ ] Push to `origin main` — explicit exception to this codebase's usual
      leave-it-local default; this dispatch explicitly asked for it.
- [ ] Do **not** build, release, notarize, or publish anything, and do not invoke
      `developer-id-release`/`release-hivematrix` — operator-only boundary.
- [ ] Append a dated entry to `~/_GD/brain/projects/hive/known-issues.md` recording
      the shipped commit SHA, so a future reworded dispatch short-circuits instead
      of redoing this.
