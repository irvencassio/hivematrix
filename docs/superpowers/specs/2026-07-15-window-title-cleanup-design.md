# Window Title Cleanup — Design

## Problem (operator ask, dispatched task)

The browser tab/window title (`<title>HiveMatrix</title>`, `src/daemon/console.ts:16`)
duplicates the in-page header logo (`<span class="logo">HiveMatrix</span>`,
`console.ts:1070`, rendered next to the `● live` connectivity indicator — the
"HiveMatrix · live" the ticket refers to). Same word, zero added information, in two
places at once. Ticket offers two directions: (1) remove "HiveMatrix" from the title
(blank is explicitly acceptable), or (2) repurpose the title for useful context
(current view, status, etc.).

No human is available to answer clarifying questions in this session (autonomous
self-improvement dispatch — see memory `project-hivematrix-self-improvement-loop`).
This doc records what was verified against the running code and the reasoning behind
the choice between the ticket's two directions.

## Current state (verified against HEAD `3420c169`, working tree clean, 2 commits
ahead of origin)

- `console.ts:16` — `<title>HiveMatrix</title>`, static, never touched by any script.
- `console.ts:1070-1071` — the page header's own `HiveMatrix` + `● live` text; this is
  the thing the ticket says already covers the branding, so the title shouldn't repeat
  it.
- No favicon is set anywhere in `CONSOLE_HTML` (grepped for `favicon`/`rel="icon"` —
  zero hits). The `<title>` text is therefore the *only* thing that currently
  identifies this tab among others in a browser tab strip.
- No existing "current view" / "active panel" state exists to hook a dynamic title to.
  Grepped for `showPanel`, `switchView`, `state.view`, `currentPanel` — zero hits. The
  console has no client-side router/view-switch concept at all; panels are shown/hidden
  ad hoc per-feature (dialogs, sidebars), not through a single tracked "current view."
  Confirmed today's already-landed `console-header-cleanup` batch (commit `909b1939`,
  design doc `2026-07-15-console-header-cleanup-design.md`) did not introduce one either
  — it explicitly kept the "HiveMatrix · live" header text as-is and added buttons next
  to it, so this is a different, narrower change, not a duplicate of that work.
- `console.test.ts` has no existing coverage of `<title>` or the header logo.

## Options considered

1. **Leave `<title>` empty (`<title></title>`).** Directly satisfies the ticket's
   explicitly-sanctioned fallback. Rejected as the primary choice: with no favicon,
   most browsers fall back to showing the page's URL/hostname (e.g.
   `localhost:3747`) in the tab strip when `<title>` is empty — arguably *more*
   clutter/confusion than the current redundant-but-legible "HiveMatrix", not less.

2. **Wire the title to dynamic "useful context"** — e.g. current view name, or the
   connectivity state already tracked for the `#live` span. Rejected: there is no
   existing "current view" concept to reuse (see above), so this would mean inventing
   a new piece of state and a new title-sync function purely to serve a cosmetic
   ticket — against AGENTS.md's complexity budget ("reuse the shared scaffolding;
   don't re-roll it," "no new concept without a documented reason"). The connectivity
   status is already visible in the header's `● live` indicator one glance away; mirroring
   it into the tab title adds a second thing to keep in sync for marginal benefit.

3. **Replace the literal duplicate with a minimal, static, non-redundant string** —
   `<title>Console</title>`. Removes the exact duplication the ticket flags (no more
   literal second "HiveMatrix"), keeps the tab identifiable in a multi-tab browser
   session (avoids option 1's blank/hostname-fallback risk), and costs zero new state
   or JS — a one-line change plus one test. `"Console"` is not an invented name: the
   file's own top-of-file doc comment already calls this "the Hive console" /
   "operator shell," and `CONSOLE_HTML`/`console.ts` are the existing internal names
   for this exact page.

## Chosen approach

Option 3. Smallest change that satisfies the ticket's actual complaint (no literal
"HiveMatrix" appears twice), avoids the blank-title UX tradeoff, and introduces no new
state, concept, or abstraction — consistent with the complexity-budget philosophy and
the precedent set by `2026-07-15-console-header-cleanup-design.md` (pick the most
defensible minimal reading over inventing a new primitive).

Scope: one line in `src/daemon/console.ts` (the `<title>` tag), one new test in
`src/daemon/console.test.ts` following that file's existing plain string/regex
assertion style against `CONSOLE_HTML` (no jsdom — the file doesn't use one). No other
files touched; `scope-wall.mjs` should be a no-op here (no persistent store, no new
concept) — run it anyway as a verification gate.
