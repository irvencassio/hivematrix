# Tools Panel Search Box Alignment — Design

## Problem

`renderToolsPanel()` (`src/daemon/console.ts` ~7790-7798) renders the `#toolsQuery`
search box *inside* `.oc-panel-head` — the same horizontal flex row as the "🛠️ Tools"
title — via an inline override:

```html
<div class="oc-panel-head">
  <div><div class="oc-panel-title">🛠️ Tools</div><div class="oc-panel-sub">...</div></div>
  <div class="sk-toolbar" style="flex:1 1 200px;margin-bottom:0"><input id="toolsQuery" .../></div>
  <span class="oc-panel-head-spacer"></span>
  <button class="linklike ov-back">← Overview</button>
</div>
```

`.oc-panel-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }`
vertically centers all of its children against the 18px title text. The result: the
search box sits mid-row, vertically centered, to the right of a two-line title block —
not left-aligned under the heading like every other panel's content, and not full-width
against the results list below it (`.tools-pane`, itself left-aligned block content).

**This placement was never a deliberate design decision.** The original spec
(`docs/superpowers/specs/2026-07-15-tools-window-search-and-run-design.md`, line 90)
only specifies filter *semantics* ("same filter semantics as `renderSkillList`"), not
visual placement — the header-row embedding was an implementation-time shortcut that
reused `.sk-toolbar` (a sidebar full-width-block pattern, see its native usage at
console.ts:1947) as a flex-item via an inline `style` override.

**Confirmed isolated to Tools:** grepped every other `.oc-panel-head` usage (Chat,
Goals, Roles, Brain/Memory Review, New task) — none of them embed a toolbar/search
input in the head row. They're all title-block + spacer + back-button only. Tools is
the only panel with this hack, so fixing it doesn't touch a shared pattern other panels
depend on.

## Options considered

1. **Keep the search box inline in the head, patch its position with more inline
   styling** (e.g. `align-self`, margin tweaks). Rejected — papers over the structural
   mismatch, still fights `flex-wrap` unpredictably at narrow widths, and leaves Tools'
   head shape inconsistent with every other panel for no reason.

2. **Move the search box to its own full-width row between `.oc-panel-head` and
   `.tools-pane`, keeping `.sk-toolbar` in its native (block, non-flex-item) form.**
   Chosen. `.oc-center-pane` is already `display:flex; flex-direction:column; gap:12px`
   with no `align-items` override (default `stretch`) — so a new direct-child row
   automatically gets full width (matching `.tools-pane`'s and the heading's effective
   width, both inset by the same `18px` pane padding) and a 12px gap on both sides, with
   zero new CSS. 12px lands at the top of the dispatch's own requested 8-12px range.
   `.oc-panel-head` reverts to the exact same title+spacer+button shape used by every
   other panel — a consistency win, not just an alignment fix.

3. **Introduce a new purpose-built search-row component.** Rejected — `.sk-toolbar`
   already does this job (flex row, gap, full-width input) elsewhere; reusing it
   respects "reuse existing tokens/components before inventing new ones" over adding a
   fourth toolbar variant to the stylesheet.

## Scope

Markup reorder only, inside `renderToolsPanel()`. No changes to the `.oc-panel-head`,
`.sk-toolbar`, or `.tools-pane` CSS rules themselves — all three are shared by other
panels/the sidebar, and the fix doesn't require touching them (precedent: the
2026-07-16 usage-toggle color fix scoped its change to a single ID selector rather than
editing the shared rule other pickers also use).

## Explicitly out of scope (noted for a future pass, not actioned here)

- `#toolsQuery` has no custom visual chrome (border/background/radius) — it renders
  with the native `color-scheme:dark` input appearance (set globally, console.ts:20/86)
  rather than the app's design-system input styling (cf. `.oc-input`). Not broken, just
  inconsistent with the rest of the console's chrome. Positioning-only dispatch; visual
  restyle is a separate concern.
- No visible `<label>`/`aria-label` beyond the `placeholder="Search tools…"` text.
  Placeholder-only labeling is a common minor a11y gap (most screen readers do pick up
  `placeholder` as an accessible name, so this isn't a hard WCAG failure) but a real
  `aria-label` would be more robust. Out of scope for an alignment-only fix.
