# 5h/7d Usage Toggle Active-State Color — Design

## Problem (operator ask, dispatched task)

The header's 5h/7d usage-window toggle (`#usageWinToggle`, added in
`2026-07-15-usage-toggle-progress-bars-design.md`) marks its active button with a
solid blue background (`.obs-win button.on { background:var(--accent-2); color:#fff; }`,
`console.ts:378`). The operator wants the active state to instead read as a yellow
border, matching the left sidebar's active-nav visual language (e.g. the "💬 Chat"
button, `#flashNav`), so "active/selected" means the same thing everywhere in the app.
Inactive toggle state and the progress-bar fill colors are explicitly out of scope
(already correct).

No human is available to answer clarifying questions in this session (autonomous
self-improvement dispatch — see memory `project-hivematrix-self-improvement-loop`).

## Current state (verified against HEAD `84fe38c9`, working tree clean, 1 commit ahead
of origin)

- `console.ts:1076-1078` — `#usageWinToggle` wraps the 5h and 7d `<button>`s. JS
  (`renderHeaderUsageWindow`, `console.ts:5778-5779`) toggles a plain `.on` class per
  button based on `_headerUsageWin`; this class-toggle logic already exists and needs
  no changes.
- `console.ts:375-378` — the shared `.obs-win` segmented-toggle CSS:
  - `.obs-win button { border:0; background:var(--panel-2); color:var(--muted); ... }`
    — inactive state. `--panel-2`/`--muted` already read as grey/muted in all three
    themes (dark/light/matrix) — satisfies "inactive: muted/grey background" already,
    no change needed.
  - `.obs-win button.on { background:var(--accent-2); color:#fff; }` — the blue active
    state to replace.
  - **This `.obs-win` class is shared** — it's also used by the Observability modal's
    window/group pickers (`obs_win_panel`, `obs_group_panel`, built in
    `renderObsWinButtons`-style code around `console.ts:3163-3164`). Editing the shared
    rule directly would silently reskin those modal pickers too, which the operator
    never asked for and wasn't reviewed for that surface.
- `console.ts:230-235` — the reference pattern being asked for, the left sidebar's
  `.ov-nav` (used by `#flashNav`/"💬 Chat" and its siblings):
  ```css
  .ov-nav { border: 1px solid var(--border); ...; transition: border-color .15s ease, color .15s ease; }
  .ov-nav:hover { border-color: var(--accent); }
  .ov-nav.active { border-color: var(--accent); color: var(--accent); }
  ```
  The border is **always 1px**, present in both states — only its *color* changes
  (`--border` grey → `--accent` gold, `#d9a441` in dark theme). That constant width is
  what makes the existing `transition: border-color` read as a smooth fade instead of a
  layout pop.
- `console.ts:144` — `* { box-sizing: border-box; }` is global, so a border added only
  in the `.on` state wouldn't overflow the layout, but it would still shrink the
  button's content box by 2px the instant it toggles on — a visible "jump," not a fade,
  and inconsistent with the existing `.obs-win button` transition
  (`transition: background .15s ease, color .15s ease`, `console.ts:856`).
- `--accent` is the existing gold/yellow design token used for "active" everywhere else
  (`.ov-nav.active`, `.addbtn.active`) — reusing it (rather than a new hardcoded yellow)
  is what makes this "the same visual pattern," not a new one.

## Options considered

1. **Edit the shared `.obs-win button.on` rule in place.** Smallest diff, but changes
   the Observability modal's window/group picker buttons too (same class, different
   surface) — an unreviewed, unrequested visual change to a second UI. Rejected: scope
   creep risk on a "CSS color values only" ticket.

2. **Scope the override to the header toggle only, via a new shared class on the
   buttons.** Would work but means editing the HTML markup (adding a class) as well as
   the CSS, for no benefit over using the ID that's already there.

3. **Scope the override to `#usageWinToggle` (the ID the toggle's own JS already
   queries at `console.ts:5779`) and mirror `.ov-nav`'s constant-border-width
   technique: reserve a transparent 1px border on both states, swap only its color (and
   the background/text color) on `.on`.** No HTML changes (the `.on` class already
   toggles correctly), no change to the shared `.obs-win` rule (Observability modal
   pickers keep their current blue, untouched), same token (`--accent`) and same
   technique (constant border width, color-only transition) as the sidebar reference —
   the actual "same visual pattern" the ticket asks for, not just the same color.

## Chosen approach

Option 3. Add, near the existing `.usage-win-bars` rules (`console.ts:343-348`):

```css
#usageWinToggle button { border: 1px solid transparent; }
#usageWinToggle button.on { background: var(--panel-2); color: var(--accent); border-color: var(--accent); }
```

(ID-selector specificity is used deliberately, not for a new-abstraction reason but a
mechanical one: `#usageWinToggle button.on` and the existing `.obs-win button.on`
otherwise have equal specificity, and — because `.usage-win-bars`'s rules sit earlier
in the file than `.obs-win`'s — a same-specificity class-only override placed there
would lose the cascade tie by source order. The ID sidesteps that regardless of where
the rule physically lives in the file.)

No JS changes. No new class, no new concept, no new persistent state — a pure CSS
color/border-color adjustment scoped to the one control the ticket names. Progress-bar
fill colors (`.usage-bar-fill.ok/warn/hi`) are untouched, so "keep green or appropriate
color" holds by construction.

Scope: `src/daemon/console.ts` (CSS only) + one new regression test in
`src/daemon/console.test.ts` following that file's existing plain string/regex
assertion style against `CONSOLE_HTML` (no jsdom — the file doesn't use one, per
precedent in `2026-07-15-window-title-cleanup-design.md`). The new test also locks in
that the shared `.obs-win button.on` rule is untouched, as a regression guard for the
Observability modal pickers. `scope-wall.mjs` should be a no-op (no new persistent
store/concept).
