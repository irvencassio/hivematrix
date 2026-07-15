# Observability Modal Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-07-15-observability-modal-popup-design.md` —
read it first for the three ambiguous calls (A: new modal reusing existing dashboard
render code; B: only the bar span opens the modal, not the whole button; C: Connectivity
section is untouched, out of scope). All facts below verified against HEAD `9b7095af`.

Frozen facts this plan depends on:
- Header bar markup: `console.ts:1073-1074`, the `<button id="usageBtn5h">`/
  `<button id="usageBtn7d">`, each with an inner `<span class="usage-bar-wrap">...`.
- Right-panel widget: `console.ts:1873-1874` (`#obsSec` `<details>`), populated by
  `renderObservability()` (`console.ts:3011`), called from the refresh cycle at
  `console.ts:5615` (`renderApprovals(); renderSkillCatalog(); renderMcp();
  renderObservability();`).
- Center-panel dashboard: `openObsDashboard()` (`console.ts:3097`), `_obsState`
  (`console.ts:3102`), `showObs()` (`console.ts:3104-3125`), `obsPanelToggles()`
  (`console.ts:3127-3135`), `renderObsPanel()` (`console.ts:3137-3150`),
  `updateObsNav()` (`console.ts:3152`). `renderObsDashboard(target)`
  (`console.ts:3427+`) and `setObsWindowPanel`/`setObsGroupPanel`
  (`console.ts:3098-3099`) are **always called with the literal string `'obsDashPanel'`**
  — no other target id is ever passed — so they can be reused completely unchanged.
- Stale comment to replace: `console.ts:1497-1498`.
- `_obsState.panelOpen` is cross-referenced (read or set to `false`) at these exact
  lines, all inside sibling panel functions' mutual-exclusion resets:
  `2053, 2088, 2110, 2525, 3736, 3754, 5887, 6927, 7057, 7577, 7608` (plus its own
  definition/use at `3102, 3114, 3116, 3138`, which go with it). Every one of these is a
  single line of the form `_obsState.panelOpen = false;` or part of an `||` boolean
  chain — confirm each with `grep -n "_obsState" src/daemon/console.ts` before editing;
  do not assume the count is exactly the same after other tasks touch nearby lines.
- Existing `.overlay`/`.modal` convention to match (7 siblings, e.g.
  `console.ts:1516-1521` `releasesOverlay` + `console.ts:6645-6661` its open/close
  functions): a `<div class="overlay" id="...">` containing `<div class="modal">`,
  opened via `getElementById(id).classList.add("open")`, closed via
  `.classList.remove("open")`, wired to a `<span class="x" onclick="closeX()">✕</span>`
  in an `<h1>`. None of the 7 has click-outside-close today — this plan adds it only to
  the new one (`onclick="if(event.target===this)closeObsModal()"` on the outer overlay
  div), per the design doc — do not retrofit the other 6.
- Test file conventions (`console.test.ts:1-52`): `extractScript(CONSOLE_HTML)` pulls
  the raw `<script>` body; `extractBetween(src, startMarker, endMarker)` slices between
  two literal strings; `fnBody(js, name)` (defined `console.test.ts:2232`) extracts one
  function's full body. Use these, not ad-hoc regex, to match house style.

---

## Task A — Add the `obsOverlay` modal + wire the progress-bar click trigger

Pure addition. Do not touch `#obsSec`, `renderObservability`, or the center-panel code
yet — this task only adds new reachable code so Task B has a replacement entry point
before it deletes the old one.

Files: `src/daemon/console.ts`, `src/daemon/console.test.ts`.

- [ ] **Tests first**, in `console.test.ts` (add near the other observability tests,
  after the `"dashboard offers a provider/model group-by toggle..."` test):

  ```ts
  test("Observability modal: overlay markup, reuses dashboard rendering, click-outside + button close", () => {
    const html = CONSOLE_HTML;
    assert.match(html, /<div class="overlay" id="obsOverlay"/, "modal overlay exists");
    assert.match(html, /id="obsOverlay"[^>]*onclick="if\(event\.target===this\)closeObsModal\(\)"/, "backdrop click closes");
    assert.match(html, /<span class="x" onclick="closeObsModal\(\)">✕<\/span>/, "explicit close button");
    // The modal must reuse the existing dashboard renderer/target id, not a new one.
    assert.match(html, /id="obsDashPanel"/, "reuses the existing dashboard mount point");
    const js = extractScript(html);
    assert.match(js, /function openObsModal\(\)/);
    assert.match(js, /function closeObsModal\(\)/);
    const openObsModal = fnBody(js, "openObsModal");
    assert.match(openObsModal, /getElementById\('obsOverlay'\)\.classList\.add\('open'\)/);
    assert.match(openObsModal, /obsPanelToggles\(\)/, "reuses the existing toggle-row builder, not a new one");
    assert.match(openObsModal, /renderObsDashboard\('obsDashPanel'\)/, "reuses the existing dashboard renderer, not a new one");
    const closeObsModal = fnBody(js, "closeObsModal");
    assert.match(closeObsModal, /getElementById\('obsOverlay'\)\.classList\.remove\('open'\)/);
  });

  test("Observability modal opens from the progress-bar visual, not the whole 5h/7d toggle button", () => {
    const js = extractScript(CONSOLE_HTML);
    // Both bar wraps must carry a click trigger that stops propagation before it can
    // reach the button's own onclick (setHeaderUsageWindow) — clicking the bar opens
    // the modal *instead of* toggling the window; clicking the "5h"/"7d" text still
    // toggles the window exactly as before this change.
    const bar5h = extractBetween(CONSOLE_HTML, 'id="usageBtn5h"', '</button>');
    const bar7d = extractBetween(CONSOLE_HTML, 'id="usageBtn7d"', '</button>');
    for (const bar of [bar5h, bar7d]) {
      assert.match(bar, /usage-bar-wrap[^>]*onclick="event\.stopPropagation\(\);openObsModal\(\)"/, "bar span opens the modal and stops propagation");
    }
    // Regression guard: the pre-existing window-toggle handler on the outer button
    // must still be exactly what it was before this change.
    assert.match(CONSOLE_HTML, /onclick="setHeaderUsageWindow\('5h'\)"/);
    assert.match(CONSOLE_HTML, /onclick="setHeaderUsageWindow\('7d'\)"/);
  });
  ```

  Run `npm test -- --test-name-pattern="Observability modal"` (or the project's
  equivalent filter) and confirm both are RED — `obsOverlay`/`openObsModal`/
  `closeObsModal` don't exist yet, and the bar spans don't have the new onclick.

- [ ] **Implement.** In `console.ts`, replace the stale comment block at
  `console.ts:1497-1498`:

  ```html
  <!-- Observability now opens in the center panel (showObs) — the old modal overlay
       was dead code (nothing added .open) and was removed. -->
  ```

  with the new modal (this becomes the *new* `.overlay`, replacing that comment
  entirely — do not keep both):

  ```html
  <!-- Observability — opened by clicking the 5h/7d usage-bar visual in the header. -->
  <div class="overlay" id="obsOverlay" onclick="if(event.target===this)closeObsModal()">
    <div class="modal" style="width:820px;max-width:92vw;max-height:88vh;overflow:auto">
      <h1>📊 Observability<span class="x" onclick="closeObsModal()">✕</span></h1>
      <div class="oc-panel-sub">Tokens, tasks, latency &amp; prompt-cache across Claude &amp; Codex</div>
      <div class="obs-panel-toggles" id="obsModalToggles"></div>
      <div id="obsDashPanel"><div class="muted">Loading…</div></div>
    </div>
  </div>
  ```

  Then add `openObsModal`/`closeObsModal` near the other center-panel Observability
  functions (right after `obsPanelToggles()`, before `renderObsPanel()` — keep them
  physically close to what they reuse):

  ```js
  function openObsModal() {
    document.getElementById('obsOverlay').classList.add('open');
    document.getElementById('obsModalToggles').innerHTML = obsPanelToggles();
    renderObsDashboard('obsDashPanel');
  }
  function closeObsModal() {
    document.getElementById('obsOverlay').classList.remove('open');
  }
  ```

  Then update the header markup at `console.ts:1073-1074` to add the click trigger to
  each bar span (only the `usage-bar-wrap` span gains the onclick; nothing else on the
  line changes). Find:

  ```html
  <span class="usage-bar-wrap"><span class="usage-bar" id="usageBar5h">
  ```
  ```html
  <span class="usage-bar-wrap"><span class="usage-bar-days" id="usageBar7d">
  ```

  Replace each `<span class="usage-bar-wrap">` opening tag with
  `<span class="usage-bar-wrap" onclick="event.stopPropagation();openObsModal()">`
  (two occurrences, one per line — do not change anything else in either line).

- [ ] Run the two new tests — confirm GREEN. Run the full `console.test.ts` suite —
  confirm the two existing tests about `setHeaderUsageWindow`/`consoleHeaderUsageToggle`
  (from the progress-bars work) are still green, unaffected by this addition.
- [ ] `npm run typecheck`, `node scripts/scope-wall.mjs` — clean.

---

## Task B — Remove the right-panel Observability widget

Now that the modal is reachable, remove the widget that used to be the only way to see
this data. Files: `src/daemon/console.ts`, `src/daemon/console.test.ts`.

- [ ] **Update tests first** (edit, don't just delete — these tests currently assert
  things that are about to become false, and one bundles an unrelated assertion that
  must survive):

  1. `"right-panel sections are collapsible <details>..."` (`console.test.ts:475-488`):
     remove `"obsSec"` from the `for (const id of [...])` array (leave `connSec`,
     `dirSec`, `skillsSec`, `mcpSec` — see design doc call C, Connectivity is untouched)
     and delete the line
     `assert.doesNotMatch(CONSOLE_HTML, /id="obsSec" open/, "info sections default collapsed");`.
     Change the test to RED first by confirming it still passes today (it does — this
     edit is a same-direction tightening, not a red/green cycle by itself), then make
     the corresponding HTML change below and confirm it still passes.

  2. `"console surfaces observability: per-task strip + totals across providers"`
     (`console.test.ts:490-500`): this test bundles two unrelated things. Split it:
     - Delete the whole test (it is about the mini-widget, which is being removed):
       the `id="observability"` mount point, `<summary>Observability`,
       `renderObservability` function, the `api("/observability` fetch, the
       `renderObservability();` render-on-refresh assertion, and the Codex strip
       assertion (`prov === "Codex" && !inTok && !outTok`) — **first grep
       `prov === "Codex" && !inTok && !outTok` across the whole script; if it also
       appears inside `renderObsDashboard`'s table code (not just
       `renderObservability`), keep a version of that one assertion pointed at
       `renderObsDashboard` instead of dropping it silently.**
     - Add a new, separate test asserting `taskTelemetryStrip` (the *unrelated*
       per-task feature, `console.ts:2987`, untouched by this plan) still exists,
       so removing the old bundled test doesn't quietly drop its only coverage:
       ```ts
       test("task session view still renders the per-task telemetry strip (unrelated to the Observability dashboard/modal)", () => {
         const js = extractScript(CONSOLE_HTML);
         assert.match(js, /function taskTelemetryStrip\(/);
         assert.match(js, /taskTelemetryStrip\(t, out\)/, "still wired into the task session view");
       });
       ```

  3. `"observability by-provider table uses fmtNum for tok in/out..."`
     (`console.test.ts:502-509`): this counts `>= 2` occurrences of the fmtNum pattern
     across "sidebar summary + full-dashboard". Once the sidebar render is deleted,
     **run this test and see what the real count is** — if `renderObsDashboard` alone
     already has 2+ occurrences (e.g. one per group-by mode), leave the assertion as
     `>= 2` with an updated comment; if it drops to 1, change to `>= 1` and update the
     comment to say "the dashboard/modal table." Do not guess — verify by running it.

  4. `"inline observability panel nests per-model rows under each provider row"`
     (`console.test.ts:528-534`): delete entirely — tests `renderObservability`
     internals directly, which no longer exists.

  5. `"observability sidebar panel drops the 'N local' pill..."`
     (`console.test.ts:547-553`): delete entirely — same reason (targets
     `renderObservability` via `fnBody`).

  6. Leave untouched: `"observability model label maps Claude ids..."`
     (`console.test.ts:511-526`, tests `obsModelTier`/`obsModelLabel`, shared helpers
     still used by `renderObsDashboard`) and `"dashboard offers a provider/model
     group-by toggle..."` (`console.test.ts:536-545`, tests `renderObsDashboard`/
     `setObsGroupPanel` directly, unaffected).

- [ ] **Implement.** In `console.ts`, delete the `#obsSec` block at
  `console.ts:1873-1874`:

  ```html
  <details class="ctx-sec" id="obsSec"><summary>Observability</summary>
  <div id="observability"><div class="muted">No task telemetry yet.</div></div></details>
  ```

  Delete `renderObservability()` (`console.ts:3011` through its closing `}` — read the
  function's actual end before cutting; do not guess the line range from this plan,
  confirm it with `extractFunctionBlock`-style brace matching or a careful read).

  Update the call site at `console.ts:5615`:
  ```js
  renderApprovals(); renderSkillCatalog(); renderMcp(); renderObservability();
  ```
  becomes
  ```js
  renderApprovals(); renderSkillCatalog(); renderMcp();
  ```

- [ ] Run the full `console.test.ts` suite — confirm GREEN, including the new/edited
  tests from this task and Task A's tests still passing.
- [ ] `npm run typecheck`, `node scripts/scope-wall.mjs` — clean.

---

## Task C — Delete the now-dead center-panel Observability machinery

Only the mini-widget ever called into this code path (`updateObsNav`'s own comment said
so). After Task B, confirm that's still true, then delete it.

Files: `src/daemon/console.ts`, `src/daemon/console.test.ts`.

- [ ] **Verify before deleting:** `grep -n "showObs()\|openObsDashboard()"
  src/daemon/console.ts` — after Task B this must show **zero** call sites (only the
  function *definitions* themselves, if anything). If some other caller turns up that
  wasn't accounted for in the design doc, stop and re-open the design doc's Decision A
  rather than deleting code something else still needs.

- [ ] **Test first** — add a regression test that these symbols are gone and the
  sibling panels are clean:

  ```ts
  test("center-panel Observability takeover is fully removed — the modal replaced it, no orphaned code", () => {
    const js = extractScript(CONSOLE_HTML);
    for (const name of ["showObs", "renderObsPanel", "openObsDashboard", "updateObsNav"]) {
      assert.doesNotMatch(js, new RegExp("function " + name + "\\("), name + " should be deleted, not left dead");
    }
    assert.doesNotMatch(js, /_obsState/, "the center-panel panelOpen flag is gone from every sibling panel function too");
  });
  ```

  Confirm RED (these all currently exist).

- [ ] **Implement.** Delete, in `console.ts`:
  - `openObsDashboard()` (`console.ts:3097`)
  - `_obsState` declaration (`console.ts:3102`)
  - `showObs()` (`console.ts:3104-3125`)
  - `obsPanelToggles()` **stays** (reused by the modal) — do not delete
    `console.ts:3127-3135`.
  - `renderObsPanel()` (`console.ts:3137-3150`) — its job was already replicated by
    `openObsModal()` in Task A; confirm `openObsModal` does not call `renderObsPanel`
    before deleting it.
  - `updateObsNav()` (`console.ts:3152`)
  - Every remaining `_obsState.panelOpen = false;` line and `|| _obsState.panelOpen`
    clause inside the sibling panel functions. Re-run
    `grep -n "_obsState" src/daemon/console.ts` right before this step (line numbers
    will have shifted from Tasks A/B) and remove each hit — these live inside
    `showFlash`/`showGoals`/`showBrain`/`showRoles`/`showTools`/`showOverview`-adjacent
    reset logic; each is a single line or a single clause inside an existing `||` chain,
    never the whole function. Leave the rest of each function untouched.

- [ ] Run the new test from this task — GREEN. Run the full `console.test.ts` suite —
  every existing test for Flash/Goals/Brain/Roles/Tools panel switching must still pass
  unchanged (they should not have asserted anything about `_obsState` directly; if one
  did, update it the same way, not by re-adding `_obsState`).
- [ ] `npm run typecheck`, `node scripts/scope-wall.mjs` — clean.

---

## Finishing

- [ ] Full verification gate: `npm run typecheck`, `npm test`,
  `node scripts/scope-wall.mjs`.
- [ ] Manual coherence read of the full diff (`git diff`): confirm it reads as one
  feature (widget → modal) rather than three disjoint patches, and that no `oc-panel`/
  `oc-center-pane` styling now has zero remaining users elsewhere in the file (if it
  does have other users — e.g. Goals/Roles/Tools panels use `oc-panel-head` too — leave
  the CSS alone; only remove CSS classes if this plan's deletions were their only user).
- [ ] Confirm manually (or via a quick grep) that `showOverview()`'s own reset logic
  (`console.ts:2053/2088/2110` per the frozen facts above) no longer references
  `_obsState` but still correctly resets every *other* real panel state — this is the
  highest-risk spot for a copy-paste-style deletion mistake because it's a long `||`
  boolean chain, not a standalone line.
- [ ] Commit to `main` directly (normal for this loop per
  `project-hivematrix-self-improvement-loop` memory) — small, well-tested diff. Do NOT
  run any release script/skill. Leave the commit unpushed (ahead of origin), consistent
  with precedent (`92856f1b`, `909b1939`, `9b7095af`) — the operator pushes + releases
  together.
- [ ] Check `~/_GD/brain/projects/hive/known-issues.md` for anything this resolves
  before updating it — this was a fresh UI enhancement ask, likely nothing to close.
