# Tools Panel Search Box Focus Loss Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-07-16-tools-search-focus-loss-design.md`
(Option 2 — once the Tools panel shell is already mounted, `renderToolsPanel()` updates
only `.tools-pane`'s innerHTML in place instead of replacing the whole `#session`
subtree, so the live `#toolsQuery` input node — and therefore its focus/cursor/selection
state — is never recreated.)

**Before starting:** re-read the current `renderToolsPanel()` source directly
(`src/daemon/console.ts`, search for `function renderToolsPanel()`) — line numbers below
are approximate and may have drifted. Do not transcribe this plan's code samples on
trust; verify each one against the real file first, the same way the previous dispatch's
subagent caught two bugs in that plan's own test code before they shipped (a
case-sensitivity typo and a wrong-occurrence `indexOf` — see `known-issues.md`'s
`7fa45ca4` entry). In particular, double-check the `lastIndexOf` reasoning below against
the actual current source before trusting it.

## Task 1 — failing test, then fix, then verify

- [ ] In `src/daemon/console.test.ts`, add a new test directly after the existing
      `"Tools panel search box sits in its own left-aligned row below the heading, not
      inline in the panel head"` test (ends ~line 2908, right before the `"goal card
      surfaces..."` test), under a new comment banner:

  ```ts
  // ─── Tools panel: search box keeps DOM focus while typing (2026-07-16) ───────
  // See docs/superpowers/specs/2026-07-16-tools-search-focus-loss-design.md and
  // docs/superpowers/plans/2026-07-16-tools-search-focus-loss.md, Task 1.

  test("Tools panel re-renders the results pane in place once mounted, instead of replacing the whole panel (which would recreate #toolsQuery and drop focus on every keystroke)", () => {
    const js = extractScript(CONSOLE_HTML);
    const panel = fnBody(js, "renderToolsPanel");

    // Guard: before falling back to a full replace, check whether the shell
    // (search input + results pane) is already mounted.
    assert.match(panel, /getElementById\('toolsQuery'\)/, "checks whether the search input already exists in the live DOM");
    assert.match(panel, /querySelector\('\.tools-pane'\)/, "locates the existing results pane to reuse");

    // When the shell already exists, only the pane's innerHTML is replaced — the
    // input node itself is never touched, so the browser never has a reason to
    // drop focus/selection on it.
    assert.match(panel, /existingPane\.innerHTML\s*=\s*body/, "the newly computed body is written directly into the existing pane");

    // The guard must actually gate the full replace — i.e. come before it in
    // source order, with a return in between — otherwise both branches would run
    // every time and the fix would be a no-op.
    const guardIdx = panel.indexOf("querySelector('.tools-pane')");
    const fullReplaceIdx = panel.lastIndexOf('session.innerHTML = \'<div class="oc-center-pane">\'');
    assert.ok(guardIdx > -1, "guard block is present");
    assert.ok(fullReplaceIdx > -1, "full-replace fallback is still present");
    assert.ok(guardIdx < fullReplaceIdx, "the guard (and its return) must run before the full-replace fallback, or it can never actually skip it");

    // Regression guard: the first-ever render (no prior shell) must still work —
    // the fallback keeps emitting the same input, unchanged.
    assert.match(panel, /id="toolsQuery"/, "search input still present in the fallback render");
    assert.match(panel, /oninput="toolsQueryInput\(\)"/, "still wired to the real-time handler");
    assert.match(
      panel,
      /id="toolsQuery"[\s\S]{0,200}attrEnc\(_toolsQuery\)/,
      "input value still reflects the persisted query in the fallback render",
    );
  });
  ```

  Before running this as RED, verify each assertion's target string actually appears (or
  actually doesn't yet appear) in the *current* source — e.g. confirm
  `session.innerHTML = '<div class="oc-center-pane">'` really is a distinct,
  unambiguous substring (check whether the error-state branch earlier in the same
  function could also match — it currently renders its markup as one single string
  literal rather than a `'...' + '...'` concatenation, so it shouldn't, but confirm this
  directly rather than trusting this plan's claim).

- [ ] Run `npm test -- --test-name-pattern="Tools panel re-renders the results pane in place"`
      (or the project's equivalent single-test filter). Confirm it **fails** against the
      current source — the `getElementById('toolsQuery')` / `querySelector('.tools-pane')`
      / `existingPane.innerHTML` assertions should all fail since none of that code
      exists yet. This is the RED step; do not proceed until you've seen it fail for the
      expected reason, not a typo/import error.

- [ ] In `src/daemon/console.ts`, in `renderToolsPanel()`, find the tail end of the
      function (after `body` has been fully computed, whether from the `!groups`
      loading branch or the filtering branch) — currently:

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
  }
  ```

  Insert a guard immediately before that `session.innerHTML = ...` assignment (leaving
  the assignment itself as the fallback, unchanged):

  ```ts
    // Once the shell is mounted, update only the results pane in place. The
    // fallback full replace below recreates every node in #session — including
    // the live #toolsQuery input — which would silently drop keyboard focus on
    // every keystroke (toolsQueryInput calls this on every oninput) and on the
    // initial loadCapabilities() resolution if it lands mid-type.
    const existingInput = document.getElementById('toolsQuery');
    const existingPane = existingInput && session.querySelector('.tools-pane');
    if (existingPane) {
      existingPane.innerHTML = body;
      return;
    }

    session.innerHTML = '<div class="oc-center-pane">'
      + '<div class="oc-panel-head"><div><div class="oc-panel-title"><span>🛠️ Tools</span></div>'
      + '<div class="oc-panel-sub">Everything the assistant can do — and what backs it</div></div>'
      + '<span class="oc-panel-head-spacer"></span>'
      + '<button class="linklike ov-back" onclick="showOverview()" title="Back to overview (Esc)">← Overview</button></div>'
      + '<div class="sk-toolbar" style="margin-bottom:0">'
      + '<input id="toolsQuery" placeholder="Search tools…" oninput="toolsQueryInput()" value="' + attrEnc(_toolsQuery) + '" />'
      + '</div>'
      + '<div class="tools-pane">' + body + '</div></div>';
  }
  ```

  (Nothing else in the function changes — the error-state branch near the top, which
  has no search box at all and returns before reaching this code, is untouched. The
  filtering/body-building logic above this tail is untouched too.)

- [ ] Run the new test again — confirm it **passes** (GREEN).

- [ ] Manually sanity-check the fix's actual effect (this bug's whole nature is a live
      DOM/focus behavior that the static test above cannot directly observe — see the
      design doc's test-strength caveat): trace through `showTools()` →
      `renderToolsPanel()` (first call, shell doesn't exist yet, full replace happens,
      mounts `#toolsQuery` + `.tools-pane`) → `loadCapabilities()` resolves → second
      `renderToolsPanel()` call (shell now exists → guard fires → only `.tools-pane`
      updates) → user types in `#toolsQuery` → `toolsQueryInput()` → third
      `renderToolsPanel()` call (guard fires again → only `.tools-pane` updates, input
      node never recreated). Confirm this chain holds by reading the actual code path,
      not just assuming the plan's description is accurate.

- [ ] Run the full verification gates and confirm all pass:
      1. `npm run typecheck` — zero errors
      2. `npm test` — all tests passing, including both pre-existing Tools-panel tests
         (their assertions all target substrings in the fallback render, which is
         unchanged — verify this rather than assuming it)
      3. `node scripts/scope-wall.mjs` — zero violations (expected: this task adds no
         new persistent store/concept, so no DECISIONS.md entry is needed)

- [ ] Report the exact commands run and their results (pass/fail counts) — do not
      declare done on a self-report; the verification output must actually be shown.
