# Observability Modal Popup — Design

## Problem (operator ask, dispatched task)

Move the Observability section out of the right sidebar into an on-demand modal/popup,
triggered by clicking the 5h/7d progress-bar area added to the header just before this
dispatch (`9b7095af feat(console): visual progress bars for the header 5h/7d usage
toggle`). The dispatch's two cited "related tasks" (progress bars; progress bars side
by side) are already done — confirmed via `git log` and today's
`2026-07-15-usage-toggle-progress-bars-design.md` / `-plan.md`. Its "Usage section
removed (separate task)" note is also already true (`92856f1b`, locked in by
`console.test.ts:475-488`). No human is available to answer clarifying questions in
this session (autonomous self-improvement dispatch — see memory
`project-hivematrix-self-improvement-loop`). This doc records what was verified against
the running code (HEAD `9b7095af`, working tree clean, 1 commit ahead of origin) and
the reasoning behind three ambiguous calls.

## Current state (verified against HEAD `9b7095af`)

Two separate, currently-live "Observability" UI surfaces exist — the dispatch's own
framing only describes one of them accurately:

1. **Right-panel mini-widget** (`#obsSec`, `console.ts:1873-1874`, a collapsed-by-default
   `<details>`), populated by `renderObservability()` (`console.ts:3011`, called from the
   main refresh cycle at `console.ts:5615`) with per-provider token totals, a
   `taskTelemetryStrip`-style summary, and an "↗ Full dashboard" link. **This is what
   the dispatch means by "currently in right panel"** and what bullet 2 asks removed.

2. **Center-panel full dashboard** (`showObs()` → `renderObsPanel()`,
   `console.ts:3097-3150`): window/group toggles (`obsPanelToggles()` — `1h/24h/7d/30d` ×
   `provider/model`) plus `renderObsDashboard(target)` (`console.ts:3427+`) rendering
   tokens/tasks/latency/prompt-cache. It replaces the middle "session" column in place,
   using the same mutual-exclusion pattern as the Flash/Goals/Brain/Roles/Tools panels
   (each sets every sibling `*State.panelOpen = false` before opening itself). Per its
   own comment (`updateObsNav`, `console.ts:3152`): "obs has no left-nav button; opened
   from the right rail" — **the mini-widget's "↗ Full dashboard" link is the only entry
   point to this view today.** A prior cleanup already deleted an actual modal-overlay
   version of this (`console.ts:1497-1498`: "the old modal overlay was dead code...
   and was removed").

This matters for ordering: naively deleting the right-panel widget first would orphan
the center-panel dashboard (no caller left) before its replacement exists. Build the new
trigger first, then remove the widget, then delete what's now provably dead — matching
the dispatch's own note ("Once popup is implemented, remove...").

Also verified: `taskTelemetryStrip()` (`console.ts:2987`, called `console.ts:2569`) is
an **unrelated, third thing** — per-task telemetry inline in a single task's session
detail view. It is not part of either Observability surface above and is untouched by
this plan, despite one existing test (`console.test.ts:490`) bundling an assertion about
it together with the mini-widget's own tests (that test gets split, not deleted whole —
see plan).

## Three ambiguous calls

### A — Is the "modal/popup" a new UI surface, or is `showObs()` (center-panel) it?

The dispatch is specific: "Modal/popup window," "Close: Click outside modal or close
button." `showObs()`'s center-panel takeover has neither property — no backdrop, no
click-outside-close, closes via a "← Overview" back-link. That's a different
interaction pattern (in-place view swap vs. floating dialog). The repo already has 6
real examples of the floating-dialog pattern being asked for (`settingsOverlay`,
`dialogOverlay`, `releasesOverlay`, `addSkillOverlay`, `mbOverlay`, `mailOverlay`,
`obWizardOverlay` — all `.overlay`/`.modal` with a `.open` class toggle and a "✕"
button). None of the six currently supports click-outside-close either, so that part is
genuinely new, not a copy of an existing convention.

**Decision:** build a real `.overlay`/`.modal` (`obsOverlay`) matching the sibling
convention, and reuse the *data-rendering* half of the existing dashboard —
`renderObsDashboard(target)`, `obsPanelToggles()`, `_obsWindow`/`_obsGroup`,
`setObsWindowPanel`/`setObsGroupPanel` — unchanged, just pointed at a target div now
living inside the modal instead of the center pane. Same target id (`obsDashPanel`) is
reused verbatim since nothing else will define that id anymore once `renderObsPanel()`
is deleted — zero changes needed inside `renderObsDashboard`/`obsPanelToggles`
themselves.

Consequence: once the mini-widget (the only caller of `openObsDashboard()`/`showObs()`)
is removed, `showObs()`, `renderObsPanel()`, `openObsDashboard()`, `updateObsNav()`, and
the `_obsState` mutual-exclusion flag become genuinely unreachable. Consistent with this
file's own precedent (the `console.ts:1497` comment shows dead UI paths get deleted
here, not left in place) and AGENTS.md's complexity budget, this plan deletes them,
including the `_obsState.panelOpen = false` cross-references in the five sibling panel
functions and two overview-reset call sites. Rejected alternative: leave them "in case
something needs it" — nothing will reference them; unreached code is a liability here,
not free insurance.

### B — What exactly is "the progress bar area" as a click target?

The 5h/7d header buttons already have a click handler
(`setHeaderUsageWindow('5h'|'7d')`, toggles which window's readout is shown — added in
`9b7095af`, has passing tests). The visual bar is a nested
`<span class="usage-bar-wrap">` *inside* that same `<button>`. Two readings: (1) the
whole button opens the modal, meaning the window-toggle behavior would need to move or
be dropped; (2) only the inner bar span opens the modal, via `stopPropagation()` so the
click doesn't bubble to the button's own `onclick` — clicking the "5h"/"7d" text outside
the bar span keeps toggling the window exactly as before.

**Decision: reading 2.** It is the literal "progress bar area" (not "the whole
toggle"), it's zero-risk to the just-shipped, just-tested toggle behavior, and it gives
the bar a second, independent affordance — glance at % via the existing toggle, click
the bar for the full dashboard. Rejected: repurposing the whole button, which would
silently regress a feature shipped two commits ago for a plan whose subject is
Observability, not the toggle.

### C — Does "Content: Latency, connectivity, system health, etc." mean also move the separate Connectivity section?

The right panel has a **separate** `<details id="connSec">Connectivity</details>`
section (`console.ts:1875-1876`), distinct from `#obsSec`. The dispatch's "Content" line
loosely lists metric *categories*, but every structural instruction in the dispatch
(title, bullet 1's trigger/display/close spec, bullet 2's "remove the Observability
section," the related-tasks list) names only Observability, never Connectivity, and the
Layout section explicitly says "Right panel: Usage section removed..., Observability
removed (this task)" with no mention of Connectivity staying or going.

**Decision:** read "connectivity, system health" as describing the *flavor* of metrics
inside the Observability dashboard (e.g. API-reachability/error-rate data that shows up
in task telemetry), not as an instruction to relocate the separate Connectivity section.
**Out of scope: `#connSec` is untouched.** This is the most defensible reading of an
imprecise line in an otherwise-precise, repeatedly-scoped dispatch, and it's the
conservative direction — leaving Connectivity alone if wrong is a much smaller miss than
deleting/moving a working, unrelated section if wrong.

## Scope

**In scope:** `obsOverlay` modal (shell, open/close, click-outside-close, reusing
`renderObsDashboard`/`obsPanelToggles` verbatim), wiring the bar-click trigger on both
5h and 7d bars, removing `#obsSec` + `renderObservability()` + its call site, deleting
the now-dead center-panel machinery (`showObs`, `renderObsPanel`, `openObsDashboard`,
`updateObsNav`, `_obsState`, its cross-references), replacing the stale
`console.ts:1497` comment, and the matching test surgery (see plan).

**Out of scope:** any behavior change to the 5h/7d toggle itself; changes to
`renderObsDashboard`'s actual metrics/content; `taskTelemetryStrip` (unrelated
per-task feature); `#connSec`; retrofitting click-outside-close onto the other 6
existing overlays (noted as a possible follow-up, not done here).
