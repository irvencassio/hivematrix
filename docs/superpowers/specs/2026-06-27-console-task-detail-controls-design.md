# Desktop Console — Task-Detail Reply/Action Control Polish (Design)

> Status: approved-by-spec (requirements + acceptance criteria supplied by the requester).
> Scope: visual/layout polish only. No routing, backend, or workflow changes.

## Problem

The desktop console (`src/daemon/console.ts`, a single self-rendered HTML/CSS/JS
document) grew its task-detail reply/action controls ad hoc. Symptoms:

1. **Cramped reply box.** `.reply-input` is styled `flex: 1`, but every reply/retry/
   steer/video textarea is rendered as a *direct block child* of `.reply-section`
   (the button row is a separate sibling). `flex: 1` is a no-op outside a flex
   parent, so the `<textarea>` collapses to its intrinsic ~20-column width instead
   of filling the column. This is the "reply boxes do not stretch" bug.
2. **Inconsistent action buttons.** Three overlapping button idioms coexist in task
   detail: `.actions button` (top row), `.reply-row button` (submit rows), and a
   one-off `.reply-primary`. Heights, padding, radius, and min-width differ; some
   rows carry inline `style="margin-top:6px;gap:8px;flex-wrap:wrap"` patches.
3. **Unclear hierarchy.** The primary "next action" is not consistently the visually
   dominant control, and the video-review block risks competing emphasis.
4. **Not responsive to the column.** The center column is a CSS grid cell (`1fr`,
   ~460px when both rails are open at 1080px, much wider when the context rail is
   collapsed). Viewport media queries can't see this; nothing makes controls stack
   when the *column* (not the window) is narrow.

## Constraints / existing structure (verified)

- `taskActionsHtml(t)` (`console.ts` ~1506–1568) renders all task-detail action and
  reply surfaces: top action bar, retry-with-guidance, steer, video-review, and the
  needs_input / review / failed reply box.
- The reply/action CSS lives in the `<style>` block ~395–419.
- `class="actions"` appears **once** (the top action row) — safe to rename.
- `.reply-row`, `.reply-input`, `.reply-primary` are used **only** inside task detail
  (CSS + `taskActionsHtml` + one JS selector) — safe to standardize.
- `setCtxSubmitDisabled` (line 1776) finds the submit button via
  `sec.querySelector(".reply-row button")` to disable it during uploads. With two
  buttons in a reply row (optional "Edit draft" + "Reply"), this currently grabs the
  *first* button — a latent bug. Retargeting to `.primary-action` fixes it.
- The center grid cell is `<section class="col session">` (`.col` has
  `overflow-y:auto`). Adding `container-type: inline-size` there enables `@container`
  queries that respond to the column width — compatible with inline-axis containment.
- Tests are source-string assertions: `extractScript(CONSOLE_HTML)` for the JS, and
  regex matches against `CONSOLE_HTML` for markup/CSS. One existing test (line 128)
  asserts `class="reply-primary" … >Reply<` and must move to the new class.
- Runtime is a macOS WKWebView (Tauri) on a current OS — CSS container queries and
  `:focus-visible` are supported.

## Chosen approach

A small, reusable **action-bar token set** plus a **true full-width reply input**,
applied uniformly inside `taskActionsHtml`, made responsive with a **container query**
on the center column. No new dependencies; all changes are within `console.ts` (+ tests).

### 1. Reusable action-bar pattern (CSS)

```
.action-bar            flex row; gap:8px; flex-wrap:wrap; align-items:center; margin:10px 0
.action-bar .primary-action     accent fill, bold — the one obvious next action
.action-bar .secondary-action   panel-2 + border — neutral/toggle actions
.action-bar .ghost-action       transparent, muted text — low-emphasis (e.g. Edit)
.action-bar .danger-action      neutral until hover→red — destructive, quiet unless hovered
```

Every role button shares: `min-height:30px`, `border-radius:6px`, `padding:6px 14px`,
`min-width:72px`, `font-size:12px`, `display:inline-flex; align-items:center;
gap:6px; justify-content:center` (icon+text align cleanly, text centered, no overflow),
and a visible `:focus-visible` outline for accessibility. `white-space:nowrap` on the
button keeps labels intact; wrapping happens at the row level.

**Hierarchy rule (picked once, used everywhere):** the **primary action is the
right-most button** in a submit row. Toggle/navigation buttons in the *top* action bar
are all `.secondary-action` (they merely open sections), so there is never a competing
primary there; the single obvious primary is the submit button inside the open section.
Destructive **Delete** is `.danger-action` (quiet; red only on hover) per "not loud
unless high risk."

### 2. Full-width, stable reply input (CSS)

`.reply-input` becomes `width:100%; box-sizing:border-box; min-height:64px;
resize:vertical` (drop the misleading `flex:1`). It now fills the column at any width,
has a stable minimum height, and still grows by the `rows` attribute for needs_input
(7 rows) / video (8 rows). No inline width styles anywhere.

### 3. Responsive to the column (CSS container query)

`section.col.session { container-type: inline-size }`. Then:

```
@container (max-width: 420px) {
  .action-bar { flex-direction: column; align-items: stretch }
  .action-bar > button { width: 100% }   /* controls stack cleanly, full-width */
}
```

Wide column → buttons sit in a horizontal row (primary right). Narrow column (context
rail open on a small window, or stacked mobile layout) → they stack full-width. The
textarea is already 100%, so it tracks the column at all widths.

### 4. taskActionsHtml refactor (JS, markup only — no handler changes)

- Top action row: `class="actions"` → `class="action-bar"`; Cancel/Retry/Reply/Archive
  → `.secondary-action` (Retry/Reply keep `reply-toggle` for active-state highlight);
  Delete → `.danger-action`.
- Retry submit row: `.reply-row` → `.action-bar`; submit → `.primary-action`.
- Steer submit row: `.reply-row` → `.action-bar`; submit → `.primary-action`.
- Reply submit row: `.reply-row` → `.action-bar`; optional Edit → `.ghost-action`;
  **Reply → `.primary-action`** (replaces `.reply-primary`, right-most).
- Video-review row: `.reply-row` → `.action-bar`; Edit script → `.ghost-action`;
  Save edits/Send → `.primary-action` (kept as the emphasized control to preserve
  current intent); Approve → `.secondary-action`; Cancel → `.danger-action`. Exactly
  one primary; drop the inline `gap/flex-wrap` patch (the bar handles it).
- Remove the now-redundant inline `style="margin-top:…"` on these rows (spacing lives
  in `.action-bar`).
- `setCtxSubmitDisabled`: selector `.reply-row button` → `.primary-action`.

The `.reply-section` / `.needs` / `.subtle` card treatments, `.reply-head`,
`.reply-subhead`, `.reply-question`, and all `onclick` handlers are unchanged, so the
needs_input standout vs. subtle-review distinction and all behavior are preserved.

## Alternatives considered

- **Viewport media queries** instead of a container query: rejected — they can't see
  the column width (context-rail collapse changes it independently of the window).
- **Keep `.reply-row`, just add `width:100%` to the textarea:** fixes #1 but leaves the
  three inconsistent button idioms (#2/#3) unaddressed. Rejected.
- **Global button refactor** across all 5366 lines: out of scope and risky; the spec
  scopes this to task-detail surfaces. Rejected.

## Acceptance criteria (from requester)

- Reply box stretches across the task-detail column. ✔ (#2)
- Button placement/sizing consistent across task detail. ✔ (#1, #4)
- Primary/secondary/danger have clear reusable styling. ✔ (#1)
- Existing task actions still work (handlers untouched). ✔ (#4)

## Test plan (source-string assertions, TDD red first)

1. `.reply-input` CSS has `width: 100%`/`box-sizing` and no `flex: 1`; no inline
   `width` on any reply textarea.
2. Task-detail action rows render `class="action-bar"`; `class="actions"` no longer
   emitted by `taskActionsHtml`.
3. needs_input reply block: exactly one `class="primary-action"…>Reply<`, responsive
   layout (container query present).
4. failed/review retry + steer submit use `.primary-action`; top-bar toggles use
   `.secondary-action`; Delete uses `.danger-action`.
5. Video-review row uses `.action-bar` with one `.primary-action`.
6. `.reply-primary` is gone (no duplicated ad-hoc role class); update legacy test.
7. `setCtxSubmitDisabled` targets `.primary-action`.
8. Container query: `section.col.session` has `container-type: inline-size` and an
   `@container` rule stacking `.action-bar`.

## Gates

`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` (all green before commit).
