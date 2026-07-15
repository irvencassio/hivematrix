# Console Header Cleanup — Design

## Problem (operator ask, dispatched task)

Three UI changes to the Hive console header/sidebar (`src/daemon/console.ts`,
server-rendered `CONSOLE_HTML` string, no build step, no React/Next despite
`COMPONENT-MAP.md`'s stale claim):

1. Add "5 hour" / "7 day" toggle buttons to the right of the "HiveMatrix · live" header text.
2. Remove the "(all projects)" project-filter dropdown from the top nav.
3. Remove the "Usage" section (Claude/Codex subscription bars) from the right sidebar.

No human is available to answer clarifying questions in this session (autonomous
self-improvement dispatch — see memory `project-hivematrix-self-improvement-loop`).
This doc records what was verified against the running code (HEAD `92856f1b`,
working tree clean, 1 commit ahead of origin) and the reasoning behind the one
genuinely ambiguous call (item 1).

## Current state (verified against HEAD `92856f1b`)

### Item 1 — no existing "context window view" concept to hook into

The exact labels "5-hour" / "7-day" appear in exactly one place today: the Claude/Codex
**subscription rate-limit windows** inside the Usage sidebar's fetch/render pipeline
(`checkUsage()`, `console.ts:5744-5869` — `sub.fiveHour`/`sub.sevenDay`, a real 18000000ms /
604800000ms pair matching Anthropic's actual rate-limit windows). A *different* time-range
concept exists elsewhere — the Observability dashboard's window toggle
(`obsPanelToggles()`, `console.ts:3128`, options `["1h","24h","7d","30d"]`) — but "5 hour"
isn't one of its options, and it lives in the center panel, not the header. There is no
existing "global page time-range" that both a header toggle and other page content already
share.

Given item 3 removes the Usage sidebar in the same batch, and the "5-hour"/"7-day" pairing
matches nothing else in the codebase, the most defensible reading is that this is a
**relocation, not an unrelated addition**: compress the sidebar's subscription-usage glance
into two small header toggle buttons, reusing the already-fetched data instead of inventing
a new concept. This keeps the complexity budget flat (AGENTS.md: reuse scaffolding, don't
re-roll) instead of adding a new page-wide time-range primitive nothing else consumes.
Chosen over two rejected alternatives:
- Wire it to the Observability dashboard's window toggle instead — rejected, no "5h" option
  exists there and it's a different data domain (task telemetry, not subscription %).
- Ship the buttons as inert chrome with no function — rejected, the ticket names an explicit
  "Function," and per-file convention here is no half-finished behavior.

Reused verbatim: the `.obs-win` / `.obs-win button` / `.obs-win button.on` CSS
(`console.ts:367-370`) is already exactly the segmented-toggle look this needs — the
Observability dashboard's own window buttons use it. No new CSS component.

### Item 2 — the dropdown is load-bearing in 5 places; a naive delete crashes the console

`console.ts:1064-1070` is the target markup, but `#projectSel` is referenced well beyond
that `<select>`:

- `console.ts:6595`, a **top-level** `document.getElementById("projectSel").addEventListener(...)`
  — runs at script-load time, outside any function. If the element doesn't exist this throws
  immediately and (per `console.test.ts`'s own docstring on why it parses the script like a
  browser) halts the rest of the top-level script — blank board, dead buttons. This is the one
  change in this batch that can silently break the entire console if handled carelessly.
- `console.ts:6543-6553` inside `loadProjects()` — populates `#projectSel`'s options and
  restores a saved value onto it (`sel.value = saved`). Same null-deref risk.
- `console.ts:9381` inside `selectProjectFromSettings()` — same (`sel.value = name`), a second,
  separate entry point (Settings → Projects card click) that sets the exact same board filter.
- `console.ts:6609`, `onProjectSelect()` — already-dead legacy no-op (its own comment: "no-op
  now that we use the search dropdown"), zero call sites confirmed by grep. Delete outright
  rather than leave a second stub next to it.

**Two distinct "project" concepts must not be conflated:**
- `state.selectedProject` (plain string, `console.ts:1977`) — the **board filter** being
  removed. Read in `renderBoard()`/Overview (`console.ts:2056,2062,2293-2294`) and as one
  fallback tier in `loadProjects()`'s New-Task-default chain (`console.ts:6576-6588`) and
  `mpAutoSelect()` (`console.ts:6404-6409`).
- `selectedProject` (module-level object `{name,path,custom}`, set via `setTaskProject()`,
  `console.ts:6247`) — **which project a new task/directive/command gets created in.** Backed
  by its own search-combobox UI (`t_project_wrapper` and siblings for directive/COO/command
  forms) and the generic multi-picker (`_mpState`/`mpSet`/`mpAutoSelect`). **Out of scope —
  not touched.**

Once every setter of `state.selectedProject` is gone, its readers in `loadProjects()` and
`mpAutoSelect()` degrade for free — they're one fallback tier in an existing priority chain
(`board filter → user default → ★ project → most-recent`), so the chain just skips a tier
that's now always empty. No changes needed to that logic. But `renderBoard()`/Overview's
`state.selectedProject ? filtered : all` ternaries are specific to the filter being removed —
leaving them in place after their only trigger is deleted is a dead, always-false branch, not
a completed removal, so those get simplified to unconditional (always show all tasks).

`refreshProjects()` (`console.ts:9395`) stays — it's also called from a Settings "↻ Re-scan"
button (`console.ts:1331`) and the New-Task empty-state rescan (`console.ts:1819`), both out
of scope.

### Item 3 — Usage `<details>` section, `console.ts:1866-1869`

```html
<details class="ctx-sec" id="usageSec" open><summary>...Usage <button id="usageRefresh" .../></summary>
<div id="usageSummary">...</div>
<details class="usage-details" id="usageDetailsSec"><summary>Per-window details</summary>
<div id="usage"></div></details></details>
```

Remove this block. Its renderers (`usageBarClass`, `usageProviderCard`, `dayTicksHtml`,
`renderSubBar`, `renderCodexBar`, `usagePlanLabel`, the bulk of `checkUsage()`,
`refreshUsageNow()`, `console.ts:5642-5879`) currently write into `#usageSummary`/`#usage`/
`#usageStatusDot`/`#usageRefresh`. `checkUsage()` already null-guards every element lookup
(`if (!el) return`, `if (statusEl) ...`) — so simply deleting the markup would degrade
silently rather than crash, unlike item 2. But leaving ~230 lines of renderer code that can
now never paint anything is exactly the dead-code case the removal is supposed to eliminate,
and this is also where item 1's data comes from — so this isn't a delete, it's a **rewrite
of the render target**: keep `checkUsage()`'s fetch + the underlying threshold logic
(`usageBarClass`, needed by item 1 too), delete the sidebar-card renderers
(`usageProviderCard`, `renderSubBar`, `renderCodexBar`, `dayTicksHtml`, the per-window
"details" breakdown, `usagePlanLabel`), and replace their call sites with one new small
renderer that writes the selected window's remaining-% + reset time into the item-1 header
readout instead. Must NOT touch `obsSec`/`renderObsPanel()`/the Observability dashboard —
a separate feature living in the same right column, out of scope.

## Chosen approach

Two independent, sequential subagent tasks (non-overlapping line ranges in the same file,
done in sequence rather than parallel to avoid any file-write races):

- **Task A** — remove the project-filter dropdown and all five dependent call sites listed
  above; simplify the two now-dead-conditional board/overview filters.
- **Task B** — remove the Usage sidebar section; add the header 5-hour/7-day toggle,
  reusing `checkUsage()`'s fetch and `.obs-win` CSS.

Both are plain deletions/relocations in one file plus its co-located test file
(`console.test.ts`, which parses `CONSOLE_HTML`'s script block the way a browser would —
exactly the harness that would have caught the item-2 top-level-throw risk). No new
persistent store, schema, or orchestration primitive — `scope-wall.mjs` should be a no-op
here; run it anyway as a verification gate.
