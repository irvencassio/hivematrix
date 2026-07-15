# Header Usage Toggle — Visual Progress Bars — Design

## Problem (operator ask, dispatched task)

Enhancement to the existing 5h/7d context-window toggle in the console header: add
visual progress-bar indicators instead of (well, in addition to) the current plain-text
toggle buttons.

> Top header should display context usage via progress bars. 5-hour: horizontal bar,
> fills proportionally (e.g. 4.5/5h = 90% full), colored fill. 7-day: horizontal bar,
> 7 tick marks (one per day), fills/highlights up to current day (day 3 of 7 →
> ✓✓✓░░░░). Both bars at the very top, right of "HiveMatrix · live", compact,
> color-coded. Clicking bar or toggle switches between 5h/7d views. Hover shows a
> tooltip with exact time remaining / day progress. Replaces the Usage section (removed
> per separate request).

No human is available to answer clarifying questions in this session (autonomous
self-improvement dispatch — see memory `project-hivematrix-self-improvement-loop`). This
doc records what was verified against the running code (HEAD `97bb0b6c`, working tree
clean, up to date with origin) and the reasoning behind the ambiguous calls.

## Current state (verified against HEAD `97bb0b6c`)

**The "Usage section removal per separate request" already happened.** A same-day,
concurrent dispatch (`docs/superpowers/specs/2026-07-15-console-header-cleanup-design.md`,
implemented in commit `909b1939`) already: removed the sidebar `#usageSec` `<details>`
block entirely, and added a plain-text `5 hour` / `7 day` segmented toggle
(`#usageWinToggle`, reusing `.obs-win` CSS) in the header's first `.hzone`, immediately
after `#live`, with a `#usageWinReadout` span next to it showing
`"NN% left · resets in Xh Ym"` for whichever window is active
(`console.ts:1064-1068`, `checkUsage()`/`renderHeaderUsageWindow()`/
`setHeaderUsageWindow()`, `console.ts:5669-5723`). **This task is purely the visual
enhancement layer on top of that already-shipped toggle** — no backend work, no new
endpoint, no new fetch. `checkUsage()` already fetches and normalizes exactly the data
needed (`_lastClaudeWins`: `[{label, remaining, utilization, resetsAt, durationMs}]` for
`5-hour` and `7-day`, sourced from `api("/usage")` → `SubscriptionUsage.fiveHour` /
`.sevenDay`, `src/lib/usage/subscription.ts`).

**The exact CSS this needs already exists, unused.** The sidebar removal deleted the
*renderer functions* (`usageProviderCard`, `renderSubBar`, `renderCodexBar`,
`dayTicksHtml`) but left their CSS in place: `.usage-bar-wrap` / `.usage-bar` /
`.usage-bar-fill` (+ `.ok`/`.warn`/`.hi`) for a continuous fill bar, and
`.usage-bar-tick` for day-boundary marks (`console.ts:328-341`). Confirmed dead today
(grep: zero HTML/JS references). Reusing these instead of inventing new bar CSS is the
"reuse the shared scaffolding" call (AGENTS.md).

**The "day 3 of 7" concept already has a formula, just no name.** `usageBarClass(util,
resetsAt, durationMs)` (`console.ts:5628-5657`) already computes, inline, exactly "which
day of the 7-day cycle are we on" as `cycleDay` (1-7) — it's the load-bearing input to
the day-paced red/green rule from
`docs/superpowers/specs/2026-07-01-usage-7-day-green-red-design.md` (supersedes
`2026-06-30-usage-7-day-whole-day-pacing-design.md`'s yellow band — 7-day windows are
green/`ok` or red/`hi` only, never `warn`). That design history is why: the tick-fill
*count* for the new 7-day bar must come from this same `cycleDay`, not be re-derived
independently, or the tick display and the status color could disagree about what day it
is.

**Existing test coverage / harness** (`console.test.ts`): a literal-text assertion on
the current toggle (`/>5 hour</`, `/>7 day</`, `console.test.ts:1655-1677`) that this
change necessarily rewrites (see below); `usageBarClass` day-pacing acceptance-example
tests (`console.test.ts:1751-1780`) that must keep passing unchanged after refactor; and
a `consoleHeaderUsageToggle()` harness (`console.test.ts:1789-1821`) that extracts
`renderHeaderUsageWindow`/`setHeaderUsageWindow`/state via `new Function(...)` against a
mock `document` — the pattern this task's new tests extend.

## Design decisions (no human available — reasoned from the spec text + existing code)

### 1. Both bars visible at once, not a single swapping view

The spec's phrasing is slightly in tension: "Clicking bar or toggle switches between 5h
and 7d views" reads like one view at a time, but "Both bars at the very top... 7-day
horizontal bar (below or alongside 5h)" only makes sense if both are simultaneously
present (you can't be "alongside" something that's hidden). Resolved in favor of **both
bars always rendered** — each toggle button gets its own live mini-bar (5h: continuous
fill; 7d: 7-tick) that always reflects current data regardless of which is "active."
Clicking still does exactly what it does today: sets `.on` / drives the shared
`#usageWinReadout` detail text (`setHeaderUsageWindow`/`_headerUsageWin`, unchanged
mechanism) — "switches between views" now means *switches which one is the detailed
text readout*, not which bar is drawn. This is a minimal-diff extension of the existing
segmented-toggle rather than a new stacked/tabbed layout, keeping the header compact
(explicitly requested twice) and reusing 100% of the existing toggle-state code.

Rejected: a single bar that morphs its shape between 5h/7d on click — closer to "one
view," but then "alongside 5h" in the spec is meaningless, and it throws away the
already-shipped, already-tested two-button toggle for no functional gain.

### 2. Button labels shorten to "5h" / "7d"

Today's buttons read "5 hour" / "7 day" in full. Adding an inline bar next to that text
inside an already-compact `.obs-win button` (`font-size:11px; padding:3px 9px`) roughly
doubles each button's width. Given "compact, horizontal" is explicit and repeated, and
the bar itself now carries the "which window" meaning (shape: continuous vs. 7-tick),
the text only needs to disambiguate at a glance — "5h"/"7d" (already the exact strings
used internally as `data-w` values) does that in a third of the space. Full detail
("42% left · resets in 2h 13m", "day 3 of 7 · resets in 4d 6h") stays available in the
adjacent `#usageWinReadout` text and in each button's hover tooltip. This intentionally
changes the literal button text asserted by `console.test.ts:1666-1667`
(`/>5 hour</`, `/>7 day</`) — those assertions get rewritten as part of this task, not
silently broken; the RED/GREEN cycle for this task's plan covers them explicitly.

### 3. Color coding: reuse ok/warn/hi status color; don't add a second hue dimension

The spec asks for "color coded... 5h in one color, 7d in another." Layering a second,
arbitrary category-identity hue (e.g. blue-for-5h/purple-for-7d) *on top of* the
existing ok/warn/hi status-color system (which is meaningful — green = fine, amber =
watch it, red = over pace — and which the 7-day-green-red design doc deliberately
restricted to only ok/hi) would mean two independent color scales on the same small
element, which reads as confusing rather than clearer, and is exactly the kind of new
concept the complexity budget (AGENTS.md) asks to avoid without a documented reason to
add it. Resolved: "color coded for clarity" is satisfied by (a) shape — continuous fill
vs. discrete 7-tick — being immediately distinguishable regardless of color, (b) the
"5h"/"7d" label, and (c) each bar keeps using the existing, meaningful ok/warn/hi (5h)
/ ok/hi (7d) status coloring, consistent with every other usage indicator in the app.
No new color tokens.

### 4. 7-day tick semantics: fill *count* = day-of-cycle, fill *color* = status

Tick count filled = `cycleDay` (1-7, extracted from `usageBarClass`, see below) — "day 3
of 7" fills exactly 3 of 7 ticks, independent of usage. Filled-tick *color* = the same
`usageBarClass(util, resetsAt, durationMs)` result already computed for that window
(`ok`/`hi`) — so if utilization is within the day's allowance the filled ticks are
green; if over pace, they're red. This reuses the existing status computation verbatim
(no new thresholds) and keeps "how far through the week" (count) and "am I over budget"
(color) as two readable dimensions of the *same* existing ok/hi signal, not a new one.
Unfilled ticks use the existing track color (`var(--border)`, same as `.usage-bar`'s
empty background).

### 5. Extract `sevenDayCycleDay(resetsAt)` — refactor before extending

`usageBarClass` currently computes `cycleDay` inline, only for its own use. The tick
renderer needs the identical value. Rather than duplicate the formula a second time
(the two prior day-pacing design docs are explicitly about *not* letting the browser
script and backend helper disagree about this math — the same risk applies to
duplicating it twice in the same file), extract a small pure helper and have
`usageBarClass` call it. This is a pure refactor (task A, below) verified by the
existing day-pacing acceptance tests continuing to pass unchanged, done *before* any
markup changes so the trickiest math is de-risked in isolation.

### 6. Tooltips: native `title` attribute, not a new tooltip component

The codebase's existing tooltip mechanism throughout the header is a plain `title="..."`
attribute (`#live`, `#ctxToggle`, `#themeToggle`, the `#modeSel` `.hgroup`). No tooltip
library/component exists or is needed. Each toggle button's `title` is set (and kept
current on every `checkUsage()` poll, not just on click, so hovering the *inactive*
button still shows current data) to the exact-detail string: 5h → `"NN% left · resets
in Xh Ym"` (identical format to today's readout text); 7d → `"Day N of 7 · NN% left ·
resets in Xd Yh"`.

## Chosen approach

Three sequential subagent tasks (shared functions/file, done in sequence rather than
parallel to avoid file-write races, matching the console-header-cleanup precedent):

- **Task A** — Extract `sevenDayCycleDay(resetsAt)` from `usageBarClass`; add direct
  unit tests; confirm existing day-pacing acceptance tests are unchanged (pure refactor,
  zero behavior change).
- **Task B** — Add the 5-hour continuous fill bar: markup inside the `5h` button, CSS
  sizing for bar-in-button context, wire `renderHeaderUsageWindow()` (or a small new
  render step called from it) to set fill width + ok/warn/hi class + `title` tooltip on
  every render, independent of active state.
- **Task C** — Add the 7-day 7-tick bar: static 7-segment markup inside the `7d` button,
  `.usage-bar-day` (+`.filled`) CSS, wire rendering to fill `cycleDay` ticks colored by
  `usageBarClass`'s ok/hi result + `title` tooltip with "Day N of 7" text. Update the
  button-label test assertions (`5 hour`→`5h`, `7 day`→`7d`) and add coverage for
  both-bars-render-regardless-of-active-window.

No new persistent store, schema, endpoint, or orchestration primitive —
`scope-wall.mjs` should be a no-op; run it anyway as a verification gate.
