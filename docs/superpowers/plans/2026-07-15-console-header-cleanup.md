# Console Header Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-07-15-console-header-cleanup-design.md`.

Both tasks touch only `src/daemon/console.ts` + `src/daemon/console.test.ts`, in
non-overlapping line ranges. Run sequentially. Verification gates after each task and
again at the end: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.

## Task A — Remove the project-filter dropdown

Files: `src/daemon/console.ts`, `src/daemon/console.test.ts`.

- [ ] **Test first** (`console.test.ts`): assert `CONSOLE_HTML` does NOT contain
  `id="projectSel"` and does NOT contain `(all projects)`. Also assert the extracted
  script (`extractScript(html)`, already defined in the test file) still parses as valid JS
  via `new Function(js)` — this is the regression guard for the top-level-`addEventListener`-
  on-a-missing-element crash risk called out in the design doc. Run `npm test` and confirm
  these two new assertions fail (RED) against current `console.ts`.
- [ ] Delete the header markup, `console.ts:1064-1070`ish: the `<span class="muted
  hlabel">project</span>`, the `<select id="projectSel">...</select>`, and the
  `<button id="projectRescanBtn" ...>↻</button>`.
- [ ] Delete the top-level `document.getElementById("projectSel").addEventListener("change",
  ...)` block (`console.ts:6595-6607`ish) in its entirety.
- [ ] Delete `onProjectSelect()` (`console.ts:6609-6611`ish) — confirmed zero remaining call
  sites (it was already a dead legacy no-op before this change).
- [ ] In `loadProjects()` (`console.ts:6538-6593`ish): delete the `const sel =
  document.getElementById("projectSel")` block and the `saved`/`state.selectedProject =
  saved` restore-from-localStorage block that follows it. Leave everything else in that
  function (project list fetch, inbox entry, `projectDropdownItems`, the Settings
  default-project selector, `populateCommandProjects`, the New-Task-default chain,
  `renderProjectDropdown()`/`renderSelectedProject()`/`mpSyncAll()`) untouched — those back
  the separate "assign a project to a new task" feature (`setTaskProject`), out of scope.
- [ ] In `selectProjectFromSettings()` (`console.ts:9379-9384`ish): delete the whole function
  (its only job was setting the board filter + `sel.value`, both gone) and its `onclick`
  wiring on the Settings → Projects card markup (leave the card as a plain, non-interactive
  info card — it already had `style="cursor:default"` despite the onclick, so removing the
  onclick makes the existing style honest instead of misleading).
- [ ] Simplify the now-always-false board/overview filters to their unconditional form:
  - `console.ts:2056-2062`ish (Overview): `state.selectedProject ? state.tasks.filter(t =>
    t.project === state.selectedProject) : state.tasks` → `state.tasks`; drop the `" · " +
    esc(state.selectedProject)` suffix on the Overview heading.
  - `console.ts:2293-2294`ish (`renderBoard()`): same simplification.
  - `console.ts:4183`ish (command-run flow): delete the `boardFilter`/`msg` branching —
    always use the plain "Launched /x — see the board." message.
  - Leave `state.selectedProject` itself declared in the `state` object init
    (`console.ts:1977`, stays `""`) and leave its reads in `mpAutoSelect()`
    (`console.ts:6407`) and `loadProjects()`'s New-Task-default chain (`console.ts:6579`)
    untouched — shared fallback logic for the separate new-task-project feature; it simply
    always skips that tier now, which needs no code change.
- [ ] Run `npm test` — confirm the two new assertions pass (GREEN), no other test regressed.
- [ ] `npm run typecheck` clean, `node scripts/scope-wall.mjs` clean.

## Task B — Remove the Usage sidebar section; add the header 5h/7d toggle

Files: `src/daemon/console.ts`, `src/daemon/console.test.ts`.

- [ ] **Test first** (`console.test.ts`): assert `CONSOLE_HTML` does NOT contain
  `id="usageSec"` (the sidebar section is gone) but DOES contain a header toggle with both
  `5 hour` and `7 day` button labels positioned in the same header zone as `id="live"`
  (e.g. assert the markup between the `<header>` open tag and the first `</div>` closing the
  live/toggle `.hzone` contains all three of `id="live"`, `5 hour`, `7 day`). Assert the
  extracted script still parses (`new Function(js)`) — regression guard for the same class
  of top-level-throw risk as Task A, this time from deleted `#usageSummary`/`#usage`/
  `#usageStatusDot`/`#usageRefresh` lookups. Run `npm test`, confirm RED.
- [ ] Delete the sidebar markup, `console.ts:1866-1869`: the entire `<details class="ctx-sec"
  id="usageSec">...</details>` block. Leave the sibling `obsSec` Observability `<details>`
  untouched.
- [ ] Add the header toggle to the first `.hzone` in `<header>` (`console.ts:1059-1063`ish),
  immediately after the existing `<span class="live" id="live">` element:
  ```html
  <span class="obs-win" id="usageWinToggle">
    <button data-w="5h" class="on" onclick="setHeaderUsageWindow('5h')">5 hour</button>
    <button data-w="7d" onclick="setHeaderUsageWindow('7d')">7 day</button>
  </span>
  <span class="muted" id="usageWinReadout" style="font-size:11px"></span>
  ```
  (`.obs-win`/`.obs-win button`/`.obs-win button.on` already exist, `console.ts:367-370` —
  no new CSS.)
- [ ] In `checkUsage()` (`console.ts:5744-5869`ish): keep the fetch (`api("/usage")`,
  `api("/providers")`) and the `claudeWins`/`codexWins` construction — item 1 needs the same
  `sub.fiveHour`/`sub.sevenDay` data. Cache the fetched `sub`/`codexSubscription` in a
  module-level variable (e.g. `let _lastUsage = null;`, set at the top of `checkUsage()`) so
  the toggle can re-render instantly on click without waiting for the next poll. Delete the
  sidebar-specific rendering: the `usageStatusDot`/`usageSummary`/`usage` element writes, and
  the now-unused renderers `usageProviderCard`, `renderSubBar`, `renderCodexBar`,
  `dayTicksHtml`, `usagePlanLabel` (keep `usageBarClass` — still needed for the header
  readout's ok/warn/hi color and by item 1's design reasoning). Delete `refreshUsageNow()`
  and its `usageRefresh` button (no longer in the DOM).
  - Add `let _headerUsageWin = "5h";` and:
    ```js
    function setHeaderUsageWindow(w) {
      _headerUsageWin = w;
      document.querySelectorAll("#usageWinToggle button").forEach(b =>
        b.classList.toggle("on", b.dataset.w === w));
      renderHeaderUsageWindow();
    }
    function renderHeaderUsageWindow() {
      const el = document.getElementById("usageWinReadout");
      if (!el || !_lastUsage) { if (el) el.textContent = ""; return; }
      const win = _headerUsageWin === "5h" ? _lastUsage.sub?.fiveHour : _lastUsage.sub?.sevenDay;
      if (!win) { el.textContent = ""; return; }
      const remaining = Math.max(0, Math.min(100, win.remaining));
      const cls = usageBarClass(win.utilization, win.resetsAt, _headerUsageWin === "5h" ? 18000000 : 604800000);
      el.textContent = remaining.toFixed(0) + "% left · resets " + fmtResets(win.resetsAt);
      el.className = "muted usage-status-dot-text " + cls; // exact class TBD by implementer to match existing ok/warn/hi color tokens (--ok/--warn/--hi), see usage-status-dot.ok/.warn/.hi rule (console.ts:339-341) for the pattern
    }
    ```
    call `renderHeaderUsageWindow()` at the end of `checkUsage()` after populating
    `_lastUsage`. (Pseudocode above — implementer should match existing code style/naming in
    the file rather than paste verbatim; e.g. confirm the exact color-class hookup against
    `.usage-status-dot.ok/.warn/.hi`, `console.ts:339-341`.)
- [ ] Run `npm test` — confirm new assertions pass (GREEN), no regression.
- [ ] `npm run typecheck` clean, `node scripts/scope-wall.mjs` clean.

## Finishing

- [ ] Full verification gate: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.
- [ ] Commit to `main` directly (normal for this loop per
  `project-hivematrix-self-improvement-loop` memory) — small, well-tested diff. Do NOT run
  any release script/skill. Leave the commit unpushed (ahead of origin), consistent with
  precedent (`92856f1b`) — the operator pushes + releases together.
- [ ] Update `~/_GD/brain/projects/hive/` if this resolves anything tracked in
  `known-issues.md` (check first; this was a fresh UI ask, likely nothing to close there).
