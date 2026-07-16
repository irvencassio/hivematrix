# Tools Panel Search Box Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-07-16-tools-search-alignment-design.md`
(Option 2 — move `#toolsQuery`'s `.sk-toolbar` wrapper out of `.oc-panel-head`'s flex
row into its own full-width block row between the heading and `.tools-pane`; no CSS
rule changes, only markup reorder inside `renderToolsPanel()`.)

## Task 1 — failing test, then fix, then verify

- [ ] In `src/daemon/console.test.ts`, add a new test directly after the existing
      `"Tools panel has a real-time search box that filters groups by name/description/kind"`
      test (ends ~line 2846, right before the `"goal card surfaces..."` test), under a
      new comment banner:

  ```ts
  // ─── Tools panel: search box alignment (2026-07-16) ──────────────────────────
  // See docs/superpowers/specs/2026-07-16-tools-search-alignment-design.md and
  // docs/superpowers/plans/2026-07-16-tools-search-alignment.md, Task 1.

  test("Tools panel search box sits in its own left-aligned row below the heading, not inline in the panel head", () => {
    const js = extractScript(CONSOLE_HTML);
    const panel = fnBody(js, "renderToolsPanel");

    const headCloseIdx = panel.indexOf("Overview (Esc)\">← Overview</button></div>");
    const toolbarIdx = panel.indexOf('<div class="sk-toolbar"');
    const paneIdx = panel.indexOf('<div class="tools-pane">');

    assert.ok(headCloseIdx > -1, "oc-panel-head's closing button/div is present");
    assert.ok(toolbarIdx > -1, "sk-toolbar wrapper is present");
    assert.ok(paneIdx > -1, "tools-pane is present");

    assert.ok(
      toolbarIdx > headCloseIdx,
      "the search toolbar must come after oc-panel-head closes, not nested inside its flex row",
    );
    assert.ok(
      paneIdx > toolbarIdx,
      "the search toolbar must come before tools-pane — its own row between the heading and the results",
    );

    // The old placement forced .sk-toolbar to act as a flex-item sized against the
    // title row (flex:1 1 200px). In its own block row it needs no such override —
    // spacing comes for free from .oc-center-pane's own gap:12px between children.
    assert.doesNotMatch(
      panel,
      /class="sk-toolbar" style="flex:1 1 200px/,
      "toolbar must not force flex-item sizing meant for oc-panel-head's row",
    );
    assert.match(
      panel,
      /class="sk-toolbar" style="margin-bottom:0"/,
      "toolbar keeps a flat margin so spacing comes from oc-center-pane's gap, not a doubled-up margin",
    );

    // Regression guard: existing search-box behavior (id, live handler, persisted
    // value) must survive the reorder unchanged.
    assert.match(panel, /id="toolsQuery"/, "search input still present");
    assert.match(panel, /oninput="toolsQueryInput\(\)"/, "still wired to the real-time handler");
    assert.match(
      panel,
      /id="toolsQuery"[\s\S]{0,200}attrEnc\(_toolsQuery\)/,
      "input value still reflects the persisted query",
    );
  });
  ```

- [ ] Run `npm test -- --test-name-pattern="Tools panel search box sits"` (or the
      project's equivalent single-test filter). Confirm it **fails** against the
      current source — `toolbarIdx > headCloseIdx` should be false (the toolbar is
      currently *before* the head's closing button, nested inside the flex row) and
      the `doesNotMatch` assertion should fail (the current source does contain
      `style="flex:1 1 200px`). This is the RED step; do not proceed until you've
      seen it fail for the expected reason, not a typo/import error.

- [ ] In `src/daemon/console.ts`, in `renderToolsPanel()` (~line 7790-7798), replace:

  ```ts
    session.innerHTML = '<div class="oc-center-pane">'
      + '<div class="oc-panel-head"><div><div class="oc-panel-title"><span>🛠️ Tools</span></div>'
      + '<div class="oc-panel-sub">Everything the assistant can do — and what backs it</div></div>'
      + '<div class="sk-toolbar" style="flex:1 1 200px;margin-bottom:0">'
      + '<input id="toolsQuery" placeholder="Search tools…" oninput="toolsQueryInput()" value="' + attrEnc(_toolsQuery) + '" />'
      + '</div>'
      + '<span class="oc-panel-head-spacer"></span>'
      + '<button class="linklike ov-back" onclick="showOverview()" title="Back to overview (Esc)">← Overview</button></div>'
      + '<div class="tools-pane">' + body + '</div></div>';
  ```

  with:

  ```ts
    session.innerHTML = '<div class="oc-center-pane">'
      + '<div class="oc-panel-head"><div><div class="oc-panel-title"><span>🛠️ Tools</span></div>'
      + '<div class="oc-panel-sub">Everything the assistant can do — and what backs it</div></div>'
      + '<span class="oc-panel-head-spacer"></span>'
      + '<button class="linklike ov-back" onclick="showOverview()" title="Back to overview (Esc)">← Overview</button></div>'
      + '<div class="sk-toolbar" style="margin-bottom:0">'
      + '<input id="toolsQuery" placeholder="Search tools…" oninput="toolsQueryInput()" value="' + attrEnc(_toolsQuery) + '" />'
      + '</div>'
      + '<div class="tools-pane">' + body + '</div></div>';
  ```

  (Only the `.sk-toolbar` block moved — from between the title-block and the spacer,
  to after the head's closing `</div>` and before `.tools-pane` — and its inline style
  dropped `flex:1 1 200px` since it's no longer a flex-row sibling. Nothing else in the
  function changes; the error-state branch near the top of the function, which has no
  search box at all, is untouched.)

- [ ] Run the new test again — confirm it **passes** (GREEN).

- [ ] Run the full verification gates and confirm all pass:
      1. `npm run typecheck` — zero errors
      2. `npm test` — all tests passing, including the pre-existing
         `"Tools panel has a real-time search box..."` test (its assertions all
         target substrings that survive the reorder unchanged — verify this rather
         than assuming it)
      3. `node scripts/scope-wall.mjs` — zero violations (expected: this task adds no
         new persistent store/concept, so no DECISIONS.md entry is needed)

- [ ] Report the exact commands run and their results (pass/fail counts) — do not
      declare done on a self-report; the verification output must actually be shown.
