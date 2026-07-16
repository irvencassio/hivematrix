# Agents Sidebar Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-07-16-agents-sidebar-consolidation-design.md` (Approach
C — reuse the existing `/lanes` endpoint + extract its existing dot-color mapping into a shared
`laneGlanceStatus()` function; new left-sidebar `#agentsSec` mirrors the `#boardSec` collapse
pattern from `f78b93d1`; remove the right sidebar's `#connSec`/`#mcpSec`, relocating their detail
into the new section).

**Scope boundary — read this first:** every change in this plan lives in `src/daemon/console.ts`
and `src/daemon/console.test.ts` only. The working tree may have *other* uncommitted files from a
different in-flight task (as of this plan's authoring: `src/daemon/server.ts`,
`src/lib/flash/flash-mcp.ts`, `src/lib/flash/self-improve-prover.test.ts`,
`src/lib/routing/aliases.ts` + their test files, plus untracked docs for unrelated same-day
dispatches). Do not edit those files, do not run `git add -A`/`git add .`, and stage only the exact
files this plan touches when committing.

Before starting Task 1, re-run `git status` and confirm which files (if any) are *still*
uncommitted from other work, so the finishing step's `git diff`/staging check has an accurate
baseline to compare against.

## Task 1 — extract shared status-mapping helpers (refactor first, no behavior change)

- [ ] In `src/daemon/console.ts`, find the current inline mapping inside `renderSettingsLanes()`
      (search for `const dotColor = lane.running`, cited at ~console.ts:8791-8794 — confirm exact
      current line numbers, they may have shifted). Extract it into a new named function placed
      near the other lane-related helpers:

  ```js
  // Single source for the running/healthy -> glance status mapping. Reused by
  // renderAgents() so the two views can't silently disagree about "healthy".
  function laneGlanceStatus(lane) {
    const color = lane.running ? (lane.healthy === false ? "var(--accent-2)" : "var(--ok)") : "var(--muted)";
    const label = lane.runtimeMode === "planned" ? "planned"
      : lane.running ? (lane.healthy === false ? "running (unhealthy)" : "running")
      : "stopped";
    return { color, label };
  }
  ```

  Update `renderSettingsLanes()` to call `const { color: dotColor, label: stateTxt } =
  laneGlanceStatus(lane);` instead of the two inline expressions. Behavior must be identical —
  this step is a pure refactor.

- [ ] Write a unit test for `laneGlanceStatus()` in `console.test.ts` (mirror the
      `extractFunctionBlock`-based style already used for `toggleBoardSection`, and the
      table-style assertions in `src/lib/lanes/status.test.ts`). Cover: running+healthy:true →
      ok-color/"running"; running+healthy:false → accent-2-color/"running (unhealthy)";
      running:false → muted-color/"stopped"; runtimeMode:"planned" → label "planned" regardless of
      `running`. **Write this test first, run it, confirm it FAILS** (function doesn't exist yet)
      before extracting the function — that's the RED step for this task.
- [ ] Extract the function, re-run the test, confirm it **passes** (GREEN).
- [ ] Run the existing test(s) covering `renderSettingsLanes()`'s rendered output, if any (grep
      `console.test.ts` for `renderSettingsLanes` or `s_lanes`) — confirm no regression from the
      refactor.

## Task 2 — new `#agentsSec` left-sidebar section: markup, CSS, collapse toggle

- [ ] Add two tests to `console.test.ts` near the Board-collapse tests (search for
      `toggleBoardSection / applyBoardSectionState`), following that exact pattern with
      `s/Board/Agents/g`, `s/board/agents/g`, `s/hm_board_collapsed/hm_agents_collapsed/g`:
      one execution-based collapse/expand/persist/restore round-trip test for
      `toggleAgentsSection`/`applyAgentsSectionState` through a fake `#agentsSec`/`#agentsToggle`
      + fake `localStorage`, and one structural regex test asserting `#agentsSec` markup (default
      `▾` glyph, wired to `onclick="toggleAgentsSection()"`) and the CSS rule
      `.agents-sec.collapsed #agents { display: none; }` exist in `CONSOLE_HTML`. **Verify the
      regex/assertions against real extracted source once written — don't trust this
      instruction's find/replace framing blindly, confirm it produces valid matching code.** Run,
      confirm **RED**.
- [ ] Add the markup immediately after `#boardSec`'s closing `</div>` (currently ~console.ts:1887,
      confirm exact location — inside `<section class="col board">`, before that section's closing
      `</section>`):

  ```html
  <div id="agentsSec" class="agents-sec">
    <div class="agents-sec-header">Agents <span id="agentsToggle" class="agents-toggle" onclick="toggleAgentsSection()" title="Collapse Agents">▾</span></div>
    <div id="agents"></div>
  </div>
  ```

- [ ] Add CSS next to `.board-sec` (~console.ts:691-694):

  ```css
  .agents-sec { margin: 0; }
  .agents-sec-header { font-size: 14px; font-weight: 600; margin: 20px 0 6px; color: var(--text); display: flex; align-items: center; gap: 8px; }
  .agents-toggle { cursor: pointer; color: var(--muted); font-size: 11px; user-select: none; }
  .agents-sec.collapsed #agents { display: none; }
  .agent-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; cursor: pointer; }
  .agent-row:hover { opacity: 0.8; }
  .agent-row .name { flex: 1; }
  .agent-row .setup-btn { font-size: 10px; }
  ```

- [ ] Add the JS (near `toggleBoardSection`/`applyBoardSectionState`):

  ```js
  function toggleAgentsSection() {
    const sec = document.getElementById('agentsSec');
    if (!sec) return;
    const collapsed = sec.classList.toggle('collapsed');
    const btn = document.getElementById('agentsToggle');
    if (btn) { btn.textContent = collapsed ? '▸' : '▾'; btn.title = collapsed ? 'Expand Agents' : 'Collapse Agents'; }
    try { localStorage.setItem('hm_agents_collapsed', collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  function applyAgentsSectionState() {
    try {
      if (localStorage.getItem('hm_agents_collapsed') === '1') {
        const sec = document.getElementById('agentsSec');
        if (sec) sec.classList.add('collapsed');
        const btn = document.getElementById('agentsToggle');
        if (btn) { btn.textContent = '▸'; btn.title = 'Expand Agents'; }
      }
    } catch (e) { /* ignore */ }
  }
  applyAgentsSectionState();
  ```

- [ ] Re-run the two tests from this task. Confirm **GREEN**.

## Task 3 — populate the section: lane rows + MCP rows + click-through

- [ ] Add a test asserting `renderAgents()`'s output given a fake `state = { lanes: [...], mcp: {
      servers: [...] } }`: one running+healthy lane → ok dot, no "Setup now"; one stopped
      `kind:"message"` lane → muted dot + "Setup now" shown; one MCP server with
      `status:"reachable"` → `.tools-dot.on`; one with `status:"unreachable"` → `.tools-dot.err`.
      Confirm **RED** (function doesn't exist).
- [ ] Add `state.lanes` to the app's `state` object initialization (wherever `state.conn`/`state.mcp`
      are initialized) and fetch `/lanes` inside the periodic `refresh()` function, in the same
      place `/connectivity` and `/mcp` are already fetched (~console.ts:5683-5706 area) — same
      pattern, same cadence, storing the result as `state.lanes = (await api('/lanes')).lanes ||
      []` (confirm the exact existing fetch pattern used for `/connectivity`/`/mcp` in `refresh()`
      and match its error-handling style, e.g. whether failures are caught individually per-call).
- [ ] Add `openLaneFromAgents(lane)` and `renderAgents()`:

  ```js
  function openLaneFromAgents(lane) {
    if (lane.kind === 'mail') { openMailBeeSetup(); return; }
    if (lane.kind === 'message') { openMessageBeeSetup(); return; }
    openSettings(); switchSettingsTab('lanes');
  }

  function renderAgents() {
    const el = document.getElementById('agents');
    if (!el) return;
    const lanes = state.lanes || [];
    const mcpServers = (state.mcp && state.mcp.servers) || [];
    const laneRows = lanes.map((lane, i) => {
      const { color, label } = laneGlanceStatus(lane);
      const needsSetup = !lane.running && (lane.kind === 'mail' || lane.kind === 'message');
      return '<div class="agent-row" onclick="openLaneFromAgents(state.lanes['+i+'])" title="'+esc(lane.statusDetail || label)+'">'
        + '<span class="dot" style="background:'+color+'"></span>'
        + '<span class="name">'+esc(lane.name)+'</span>'
        + (needsSetup ? '<span class="setup-btn muted">Setup now</span>' : '<span class="muted setup-btn">'+esc(label)+'</span>')
        + '</div>';
    }).join('');
    const mcpRows = mcpServers.map(s => {
      const dotCls = s.status === 'reachable' ? 'on' : (s.status === 'unreachable' ? 'err' : 'off');
      return '<div class="agent-row" onclick="openSettings()" title="'+esc(s.detail || s.status)+'">'
        + '<span class="tools-dot '+dotCls+'"></span>'
        + '<span class="name">'+esc(s.name)+' (MCP)</span>'
        + '</div>';
    }).join('');
    const healthRow = '<div class="agent-row" onclick="openSettings(); switchSettingsTab(\'lanes\')"><span class="name muted">System Health</span><span class="muted setup-btn">View status →</span></div>';
    el.innerHTML = laneRows + mcpRows + healthRow;
  }
  ```

  Call `renderAgents()` in `refresh()` right after `state.lanes`/`state.mcp` are populated, same
  place `renderConn()`/`renderMcp()` are currently called.
  **Verify `esc()` is the actual existing HTML-escaping helper name used elsewhere in this file
  (it is, per `renderMcp()`'s own use of `esc()`) before relying on it here.**
- [ ] Re-run the test from this task. Confirm **GREEN**.

## Task 4 — remove the old right-sidebar sections, relocate Connectivity detail

- [ ] Grep `console.ts` for every reference to `connSec`, `mcpSec`, `#conn"`, `#mcp"` (the
      container ids, not the `/connectivity`/`/mcp` API paths) to enumerate every call site before
      changing anything.
- [ ] Delete the `<details class="ctx-sec" id="mcpSec">...</details>` block
      (~console.ts:1968-1969). Confirm nothing else references `#mcpSec` or calls `renderMcp()`
      expecting `#mcp` to exist outside the block you just deleted — if `renderMcp()`/`restartMcp()`
      have no remaining callers/DOM targets after this, remove them too (their logic's replacement,
      the MCP rows in `renderAgents()`, does not call them); if something else still legitimately
      uses them, leave them and just stop calling `renderMcp()` from the right-sidebar refresh path.
  - [ ] Add/update a test confirming `mcpSec`/`id="mcp"` no longer appear in `CONSOLE_HTML`.
- [ ] Delete the `<details class="ctx-sec" id="connSec" open">...</details>` wrapper
      (~console.ts:1896-1897), but relocate its *inner* `<div id="conn"></div>` (and thus
      `renderConn()`'s existing behavior) into the new Agents section, as a collapsible sub-block
      below the lane/MCP rows, e.g.:

  ```html
  <div id="agentsSec" class="agents-sec">
    <div class="agents-sec-header">Agents <span id="agentsToggle" class="agents-toggle" onclick="toggleAgentsSection()" title="Collapse Agents">▾</span></div>
    <div id="agents"></div>
    <details class="ctx-sec" id="agentsConnDetail"><summary>Connectivity detail</summary>
    <div id="conn"></div></details>
  </div>
  ```

  `renderConn()` itself needs no code changes — it already targets `#conn` by id, and ids are
  unique regardless of new parent. Keep calling `renderConn()` from `refresh()` exactly as before.
  - [ ] Add/update a test confirming `connSec` (the old top-level right-sidebar wrapper) no longer
        appears in `CONSOLE_HTML`, but `id="conn"` still does (now nested under `#agentsSec`).
- [ ] Run the full test file. Confirm **GREEN**, no regressions from removing the two sections
      (check for any other test asserting `connSec`/`mcpSec` presence that now needs updating to
      match the new location, not just deleted — if a prior test asserted *presence* of these
      sections as a regression guard for an earlier fix, update it to assert the new location
      instead of just deleting the coverage).

## Verification gates (run after Task 4, before declaring done)

- [ ] `npm run typecheck` — zero errors
- [ ] `npm test` — full suite passes (confirm no regression beyond the one known pre-existing skip
      noted in the Board-collapse plan)
- [ ] `node scripts/scope-wall.mjs` — zero violations (expected no-op: no new persistent
      store/concept, no brand/surface strings touched)

## Finishing

- [ ] `git status` / `git diff` — confirm **only** `src/daemon/console.ts` and
      `src/daemon/console.test.ts` changed (plus these two doc files). If other files show as
      modified, they belong to unrelated in-flight work already present in the working tree before
      this task started (per the Scope boundary note above) — do not stage or commit them.
- [ ] Stage only `src/daemon/console.ts`, `src/daemon/console.test.ts`,
      `docs/superpowers/specs/2026-07-16-agents-sidebar-consolidation-design.md`,
      `docs/superpowers/plans/2026-07-16-agents-sidebar-consolidation.md` by name — never `git add
      -A` / `git add .`.
- [ ] Commit to `main`: `Consolidate lanes/agents setup and monitoring to left sidebar`.
- [ ] Push to `origin main` — explicit dispatch instruction, consistent with this codebase's
      established precedent of honoring an explicit per-dispatch push request.
- [ ] Do **not** build, release, notarize, or publish anything, and do not invoke
      `developer-id-release`/`release-hivematrix` — operator-only boundary. The dispatch itself
      also says "No build at this time."
- [ ] Append a dated entry to `~/_GD/brain/projects/hive/known-issues.md` recording the shipped
      commit SHA and a one-line description of what moved where, plus the two Non-goals follow-ups
      (status-vocabulary unification, Canopy dual-check reconciliation) as open items, so a future
      dispatch either short-circuits on the done part or picks up the flagged follow-ups instead of
      rediscovering them from scratch.
