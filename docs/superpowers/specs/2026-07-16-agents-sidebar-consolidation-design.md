# Agents Sidebar Consolidation — Design

## Problem (dispatch ask, with premises corrected against actual code)

The dispatch describes lane/agent setup and monitoring as fragmented across: right-sidebar
"System Readiness", Settings > Setup modal, right-sidebar "Connectivity", right-sidebar "MCP
Servers", with Canopy mentioned redundantly across all three. Ask: one collapsible "Agents"
section in the left sidebar showing 🟢/🟡/🔴 status per lane (Desktop/Browser/Message/Mail) and
per MCP server (Canopy/Flash), click-through to setup, replacing the right-sidebar sections.

**Two premises don't match the current code** (verified against HEAD `f78b93d1`):

1. **"System Readiness" is not a right-sidebar section.** It lives inside the Settings modal's
   "Lanes" tab (`renderSystemReadiness()`, `console.ts:8557-8612`, backed by `GET
   /system/readiness` → `src/lib/system-readiness/index.ts:292-348`), plus a condensed banner on
   the About tab (`renderHomeReadinessBanner()`, `console.ts:8466-8489`). There is nothing named
   "System Readiness" in the right sidebar to remove.
2. **Canopy is not one of the System Readiness checks.** `system-readiness/index.ts`'s checks are
   daemon, COO routing rules, Browser Lane readiness, lane apps, workflow inbox, recent failed
   tasks, and (conditionally) Message Lane access — "canopy" does not appear in that file. Canopy's
   configured-status is computed by two *other*, disagreeing places: `onboarding.ts:180-188`
   (requires both `/Applications/Canopy.app` on disk *and* a `canopy` key in `~/.claude.json`) and
   `mcp/registry.ts`'s `claudeCodeServers()` (checks only the `~/.claude.json` key, no filesystem
   check). That's the real redundancy worth fixing, not a "readiness check" duplication.

The right sidebar's actual fragmented sections are **Connectivity** (`#connSec`, shows Desktop +
Browser Lane capability posture, but not Message/Mail Lane at all) and **MCP Servers** (`#mcpSec`,
lists Canopy/Flash/etc. via `GET /mcp`). Settings > Setup is itself a tangle of three parallel
models (`renderSettingsSetup()` reading `state.onboarding.steps`; the sidebar's own `#onboarding`
block which calls `renderSettingsSetup()` and adds auto-hide logic; and a third guided-wizard
model, `setup-status.ts`'s `SetupItemState` enum, used only by `openObWizard()`). Message/Mail Lane
each have a *fourth* readiness computation copied inline in their own setup modals
(`renderMessageBeeState()`, `console.ts:5434`, comment: "Mirrors setup-status.ts's
buildFullDiskAccess()..."). Browser Lane auth has no Setup-flow representation at all — it's a
separate Settings > Lanes subsection (`renderBrowserReadiness()`).

## Current state — the pieces this design reuses

**`GET /lanes`** (`server.ts:1613-1614` → `listLaneServiceStatuses()`,
`src/lib/lanes/status.ts`) is the one endpoint that already uniformly covers all four lanes
(`STATUS_KIND_TO_LANE` maps `desktopbee→desktop`, `browserbee`/`webbee`→`browser`,
`mailbee→mail`, `messagebee→message`) with a real, honest 3-way signal per lane: `running:
boolean`, `healthy: boolean|null`. It's already rendered today in
`renderSettingsLanes()` (`console.ts:8784-8813`, Settings > Lanes tab, container `#s_lanes`),
fetched on-demand (only when that tab opens), with this exact inline mapping:

```js
const dotColor = lane.running ? (lane.healthy === false ? "var(--accent-2)" : "var(--ok)") : "var(--muted)";
const stateTxt = lane.runtimeMode === "planned" ? "planned"
  : lane.running ? (lane.healthy === false ? "running (unhealthy)" : "running")
  : "stopped";
```

...plus a `setupBtn` that's already wired to the exact right modals: `lane.kind === 'mail' →
openMailBeeSetup()`, `lane.kind === 'message' → openMessageBeeSetup()`.

**`GET /mcp`** (`server.ts:3980-4001` → `registry.ts`) is already polled every 5s
(`console.ts:5706`, inside the `refresh()` `setInterval`) into `state.mcp`, and already rendered
by `renderMcp()` (`console.ts:4405-4420`) with a `.tools-dot` on/off/err mapping and a restart
button per server (`restartMcp(name)`).

**`GET /connectivity`** is already polled every 5s into `state.conn`, rendered by `renderConn()`
(`console.ts:3640-3676`) — mode/override/exhausted/probe-fails/reason plus a capability-posture
list. Note per its own code comment (`console.ts:3642-3645`): connectivity *mode* already folds
into the header's "● live" indicator ("Phase 2 header cleanup") — `#connSec` today mostly shows
*supplementary* detail beyond what's already visible in the header.

**Left-sidebar collapsible-section precedent**: `#boardSec`/`.board-sec-header`/
`toggleBoardSection()`/`applyBoardSectionState()`/`localStorage['hm_board_collapsed']`
(`console.ts:1884-1887`, CSS `console.ts:691-694`, JS `console.ts:~2365-2393`, from
`f78b93d1` — see `docs/superpowers/{specs,plans}/2026-07-16-board-section-collapse*.md`). A
static-markup + dedicated-toggle-function pattern (not the right sidebar's generic `<details
class="ctx-sec">` + `wireCtxSections()` pattern), because `renderBoard()`/`renderAgents()`
periodically overwrite their content container's `innerHTML`, which would destroy any collapse
state kept on that inner element.

**Settings tab-switch mechanism**: `switchSettingsTab('lanes')` (`console.ts:6835-6845`) shows the
Lanes panel and eagerly re-renders `renderSystemReadiness()` + `renderLaneSetup()` +
`renderBrowserReadiness()` + `renderSettingsLanes()` + more — i.e., this one call already produces
the full "system health" view the dispatch's mockup asks for. `openSettings()`
(`console.ts:6629-6640`) opens the modal but hardcodes `switchSettingsTab("about")` as its first
(synchronous, pre-`await`) statement — calling `openSettings(); switchSettingsTab('lanes');` as two
sequential statements lands correctly on Lanes (the "about" switch runs synchronously inside
`openSettings` before its first `await` suspends it, so the caller's next statement runs after that
prefix, not racing it).

## Approaches considered

**A. Build a new unified lane-status backend model/endpoint from scratch**, reconciling all 5+
existing status vocabularies (`LaneServiceStatus`, `CapabilityPosture`, `CapabilityAvailability`,
`SetupItemState`, the 4 Browser-Lane-app enums) into one. Rejected for this pass: real value, but
a multi-day backend migration with call-site risk across onboarding/connectivity/lane-apps, far
beyond a UX-consolidation dispatch's budget and scope. Flagged as a follow-up (see Non-goals).

**B. New Agents section computes its own fresh status logic per lane**, independent of
`renderSettingsLanes()`. Rejected: would be a *third* copy of the exact running/healthy → dot-color
mapping (Settings > Lanes already has one inline; this would add a second inline copy elsewhere) —
directly the kind of duplication this dispatch exists to reduce.

**C. (Recommended) Extract `renderSettingsLanes()`'s existing dot-color/state-text mapping into one
shared pure function, add `/lanes` to the existing 5s poll alongside `/connectivity`/`/mcp`, and
render a new left-sidebar "Agents" section from that shared `state.lanes` + already-polled
`state.mcp`.** Zero new backend endpoints, zero new persistent stores, zero new status
vocabularies — reuses the one endpoint that's already honestly uniform across all 4 lanes, and
fixes one real instance of duplication (the dot-color mapping) as a side effect instead of adding a
third copy.

## Recommended design

### Data

- Add `/lanes` to the periodic `refresh()` poll (`console.ts:5683-5706` area) into a new
  `state.lanes` field, same cadence as the existing `/connectivity` and `/mcp` calls it sits next
  to.
- Extract the mapping already inline in `renderSettingsLanes()` (`console.ts:8791-8794`) into a
  named function, e.g.:

  ```js
  // Single source for the running/healthy -> glance status mapping. Previously
  // inline only in renderSettingsLanes(); reused by renderAgents() so the two
  // views can't silently disagree about what "healthy" means.
  function laneGlanceStatus(lane) {
    const color = lane.running ? (lane.healthy === false ? "var(--accent-2)" : "var(--ok)") : "var(--muted)";
    const label = lane.runtimeMode === "planned" ? "planned"
      : lane.running ? (lane.healthy === false ? "running (unhealthy)" : "running")
      : "stopped";
    return { color, label };
  }
  ```

  `renderSettingsLanes()` calls this instead of repeating the two inline expressions;
  `renderAgents()` (new) calls the same function.

### Markup + CSS (mirrors the Board precedent exactly)

Left sidebar, inside `<section class="col board">`, immediately after `#boardSec`
(`console.ts:1884-1887`):

```html
<div id="agentsSec" class="agents-sec">
  <div class="agents-sec-header">Agents <span id="agentsToggle" class="agents-toggle" onclick="toggleAgentsSection()" title="Collapse Agents">▾</span></div>
  <div id="agents"></div>
</div>
```

Default glyph `▾` (expanded) — matches the mockup's "red status immediately visible" goal; unlike
Board, there's no reason to default this to collapsed.

CSS, next to `.board-sec` (`console.ts:691-694`):

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

`.dot` (existing, `console.ts:682-684`) and `.tools-dot`/`.on`/`.off`/`.err` (existing,
`console.ts:945-949`) are reused as-is for the status glyphs — no new dot classes.

### JS

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

Called once per `refresh()` tick, same place `renderConn()`/`renderMcp()` are already called
(`console.ts:5683-5706` area), right after `state.lanes` is populated.

### Removing the old right-sidebar sections

Delete the two `<details class="ctx-sec">` blocks at `console.ts:1896-1897` (`#connSec`) and
`console.ts:1968-1969` (`#mcpSec`), and their call sites in `refresh()`
(`renderConn()`/`renderMcp()` — note `renderMcp()` itself is **not** deleted, just no longer called
from `refresh()`'s right-sidebar path; it's superseded by the inline MCP rows in `renderAgents()`
above, which duplicate its dot-mapping logic inline rather than calling the now-removed function,
since `renderMcp()`'s DOM target `#mcp` no longer exists). Actually — to avoid a second inline copy
of the MCP dot-mapping (same duplication concern as lanes), extract `renderMcp()`'s per-server dot
class expression into a tiny shared `mcpDotClass(status)` helper the same way `laneGlanceStatus()`
was extracted, and delete `renderMcp()`/`restartMcp()`'s DOM-target usage entirely since nothing
else references `#mcp`/`#mcpSec` after this change (confirm via grep before deleting — if
`restartMcp` is referenced only from the now-removed markup, delete it too; if some other surface
also restarts MCP servers, keep it and wire the Agents MCP rows to call it instead of just
`openSettings()`).

`renderConn()`'s existing detail (mode/override/exhausted/probe-fails/reason + posture list) is not
deleted — it still needs a home per "Connectivity section (migrate to Agents)". Simplest
non-regressive move: keep `renderConn()` and its `#conn` target, but relocate the container to
live inside `#agentsSec` (below the glance rows) instead of its own top-level `ctx-sec`, e.g. wrap
it as a details/summary sub-block ("Connectivity detail ▾") inside the Agents section body. This
preserves 100% of the existing detail with a one-line container relocation, rather than
re-implementing it.

### System Readiness

Not moved (it isn't in the right sidebar today — see Problem section). The new "System Health →"
row simply opens Settings > Lanes, where `renderSystemReadiness()` already lives. No change to
`system-readiness/index.ts` or its render functions.

## Non-goals

- **No unification of the 5+ status vocabularies** (`LaneServiceStatus`, `CapabilityPosture`,
  `CapabilityAvailability`, `SetupItemState`, the 4 Browser-Lane-app enums) into one type. Recorded
  here as a legitimate follow-up, not silently dropped — a future dispatch could target this
  specifically, now that `laneGlanceStatus()`/`mcpDotClass()` exist as a starting seam.
- **No reconciliation of the two disagreeing "is Canopy configured" checks**
  (`onboarding.ts:180-188` vs `mcp/registry.ts`'s `claudeCodeServers()`). Also a legitimate
  follow-up; out of scope for a display-layer consolidation.
- **No 3-way (configured/warning/offline) status for every row.** Lanes get an honest 3-way signal
  from `/lanes`' real `running`/`healthy` fields. MCP servers get the 3-way signal `renderMcp()`
  already computes (`reachable`/`unreachable`/other). Not fabricating a "warning" state anywhere the
  underlying data is genuinely binary.
- **Not touching Settings > Setup's three-parallel-models tangle** (`renderSettingsSetup()` /
  sidebar `#onboarding` / the guided first-run wizard's `setup-status.ts`). Real duplication, but
  reconciling it is a separate, larger effort than relocating Connectivity/MCP Servers display.
- **Not moving Browser Lane auth** (`renderBrowserReadiness()`, Settings > Lanes) — its detail stays
  where it is; the Agents section's Browser Lane row just links there via `switchSettingsTab('lanes')`,
  consistent with how Desktop Lane is also handled (neither has a dedicated standalone setup modal
  like Mail/Message do).
- **No DECISIONS.md entry.** No new persistent store, kernel concept (Event/Task/Directive/
  Policy/Persona/Memory), or product concept — one more `localStorage` UI-preference key
  (`hm_agents_collapsed`) following the exact existing convention (`hm_board_collapsed`,
  `hm_ctx_collapsed`, `hm_lanes_collapsed`), plus reusing existing endpoints/data.

## Testing approach

Following the `console.test.ts` conventions used for the Board collapse feature
(`f78b93d1`):

1. **Collapse round-trip** (execution-based, mirrors `toggleBoardSection`/
   `applyBoardSectionState`'s test): `toggleAgentsSection`/`applyAgentsSectionState` against a fake
   `#agentsSec`/`#agentsToggle` + fake `localStorage`, asserting the full
   collapse/expand/persist/restore cycle through `localStorage['hm_agents_collapsed']`.
2. **Structural markup/CSS assertions** (regex on `CONSOLE_HTML`): `#agentsSec` exists inside
   `<section class="col board">` after `#boardSec`; default glyph `▾`; the
   `.agents-sec.collapsed #agents { display: none; }` rule exists; `#connSec`/`#mcpSec` (the old
   `ctx-sec` blocks) no longer exist in `CONSOLE_HTML`.
3. **`laneGlanceStatus()` unit tests** (mirrors the style of `src/lib/lanes/status.test.ts`):
   running+healthy-true → ok color/"running"; running+healthy-false → accent-2/"running
   (unhealthy)"; not-running → muted/"stopped"; runtimeMode "planned" → "planned" regardless of
   running. Extract via the same `extractFunctionBlock` helper `console.test.ts` already uses for
   other inline functions.
4. **`renderAgents()` output test**: given a fake `state` with `lanes: [...]` (one of each
   running/unhealthy/stopped) and `mcp: {servers: [...]}` (one reachable, one unreachable), assert
   the rendered `#agents` innerHTML contains the right dot color/class per row and the "Setup now"
   affordance only for stopped mail/message lanes.
5. **No regression in `renderSettingsLanes()`**: existing tests (if any) covering its dot
   color/state text still pass after it's refactored to call `laneGlanceStatus()` — behavior
   unchanged, implementation reuses the extracted function.

Implementers: verify every assertion above empirically against the real extracted source before
running it as the RED step — do not paste this doc's illustrative code verbatim on trust (plan docs
can themselves contain the same class of bug they're meant to catch).
