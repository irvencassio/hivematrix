# Composer Send Button Fix + Snippet CRUD/Reorder — Design

> Non-interactive self-improvement session. Requirements arrived fully specified
> by the dispatch; no open design questions needed operator input. Self-approved
> after the standard brainstorming pass below — see AGENTS.md's Superpowers
> pipeline and the self-improvement loop's non-interactive constraint.

## Context

- This extends `docs/superpowers/specs/2026-07-16-message-composer-snippets-design.md`
  and its plan `docs/superpowers/plans/2026-07-16-message-composer-snippets.md`.
  That prior session shipped: taller composer (Task Group A), and Task Group B
  — snippet storage, the Snippets button, the modal shell, list-view rendering,
  and insert-at-cursor. Confirmed still present in `src/daemon/console.ts`
  (button markup ~7224-7227, `DEFAULT_SNIPPETS`/`loadSnippets`/`saveSnippets`
  ~8649-8667, modal + `openSnippetsModal`/`closeSnippetsModal`/`renderSnippetsList`/
  `snippetRowHtml`/`insertSnippet` ~8673-8708) and covered by tests at
  `console.test.ts:3803-3910`.
- Task Group C (Create/Edit, Delete, Drag-reorder) in that plan was written but
  never executed — confirmed via `git log --grep=snippet` (only one commit,
  titled "view/insert") and the plan file itself has no completed-task
  markers for Group C. Today's dispatch asks for exactly this: create, update,
  delete, and persisted drag-to-reorder. **Group C's design is reused as-is**
  — it was already reviewed and is still accurate against the live file (see
  verification above). No new design decisions needed for that half of the work.
- Today's dispatch *also* asks to fix the Send button's undersized/inconsistent
  styling. The 07-16 design doc explicitly flagged this as a **known, separate
  bug** and declared it a non-goal to avoid scope creep into an unreviewed
  area (design doc lines 59-62). It is now in scope by explicit operator ask.

## Root cause: Send button styling

`src/daemon/console.ts:7227`:
```
'<button class="create" id="flashSendBtn" onclick="event.stopPropagation();flashSend()" disabled>Send</button>'
```
Photo/Mic/Snippets all use `class="oc-mic-btn"` (styled at `console.ts:931-935`:
padding `7px 6px`, `1px solid var(--border)` border, `8px` radius, `var(--code-bg)`
background, `12px` font). Send instead uses `class="create"`, but the only CSS
rule for that class is `.form button.create { ... }` (`console.ts:253`) —
scoped to a `.form` ancestor. `flashSendBtn` lives in
`.oc-panel-composer-shell > .oc-panel-composer-actions`, never inside a `.form`,
so the rule never matches and Send falls back to unstyled browser-default
button chrome. That's the entire bug — no JS logic involved, pure CSS/markup.

**Fix:** change `flashSendBtn`'s class from `"create"` to `"oc-mic-btn"`,
matching Photo/Mic/Snippets exactly (same padding, border, radius, font,
background). This is the literal ask ("match the same button size/style/
padding as the other three") and keeps the fix a one-line class swap with no
new CSS. `disabled`/enabled toggling logic (`console.ts:7244`, `8473`, `8515`,
`8521`, `8632`) reads/writes the `disabled` DOM property directly and doesn't
reference the class, so it's unaffected.

**Alternatives considered and rejected:**
- Add an unscoped `button.create` rule instead of reclassing Send: this
  would only fix Send in isolation and leave a second, subtly-different pill
  style in the CSS for one button — more surface area for future drift than
  reusing the exact class the other three already share.
- Keep an accent/primary-action color on Send via a modifier class (e.g.
  `.oc-mic-btn.accent`): tempting for visual hierarchy, but the dispatch is
  explicit that Send should match the *other three's* size/style/padding, not
  introduce a new variant. Not asked for; skipping to avoid scope creep.

## Snippet CRUD/reorder — reusing the 07-16 plan's Task Group C verbatim

Full design (create/edit view, delete confirmation via `hmConfirm`, native
HTML5 drag-and-drop reorder) is unchanged from
`docs/superpowers/specs/2026-07-16-message-composer-snippets-design.md`
(sections "Modal" and "Drag-to-reorder"). Key points restated for this
session's implementers, since that's the part actually being executed today:

- **Same overlay, no nested overlay-on-overlay.** Create/Edit is a second view
  swapped into the existing `#snippetsOverlay`, not a new modal.
- **Create:** "+ Create" button in list view opens the edit view empty.
- **Edit:** each row's Edit control opens the edit view pre-filled with that
  row's `name`/`text`, matched by `id` on Save.
- **Validation:** non-empty name and text required before Save is enabled/
  accepted (implementer picks disable-Save vs. `hmAlert`, stays consistent,
  and is covered by a test either way).
- **Delete:** `hmConfirm('Delete snippet "' + esc(name) + '"?', {okLabel:
  "Delete", danger:true})`, only removes on truthy resolution.
- **Reorder:** native HTML5 DnD (`draggable`/`dragstart`/`dragover`/`drop`) on
  each row — `dragstart` records the source index in a closure variable,
  `dragover` calls `preventDefault()` and tracks the hover index, `drop`
  splices the array to the new position and calls `saveSnippets` (persists
  immediately — the dispatch says "persists the new sort order").
- **Storage:** still `localStorage['hm_snippets']`; array order is
  display/insert/reorder order, no separate sort field.

## Non-goals (unchanged from 07-16, still applicable)

- No server-side/DB persistence for snippets.
- No touch/mobile drag support beyond native HTML5 DnD — desktop
  Tauri/WKWebView runtime only.
- No visual redesign of the modal beyond what create/edit/delete/reorder
  require.

## Complexity budget accounting (AGENTS.md Q14)

- New persistent store: **none** — same `hm_snippets` localStorage key as
  07-16; Send button fix touches zero storage.
- New product concept: **none** — CRUD/reorder is completing an
  already-scoped UI preference feature, not introducing a new orchestration
  primitive. No DECISIONS.md entry required.

## Testing strategy

Same as 07-16: regex/string assertions against `CONSOLE_HTML` and the
extracted `<script>` body via `console.test.ts`'s existing
`extractScript`/`extractFunctionBlock`/`fnBody`/`extractBetween` helpers —
this file's established, deliberately-chosen harness (no jsdom). New tests
will assert:

- Send button markup uses `class="oc-mic-btn"` (not `class="create"`).
- Create/Edit view markup + Save/Cancel wiring; Save appends-or-updates by id
  and calls `saveSnippets`; Cancel returns to list view without saving.
- Delete control calls `hmConfirm` with `danger:true` and only mutates/saves
  on truthy resolution.
- Row `dragstart`/`dragover`/`drop` handlers exist, call `preventDefault()`
  on dragover, and splice + `saveSnippets` on drop.

## Rollout

- Two commits, matching the two independent pieces of work: (1) Send button
  class fix, (2) snippet create/edit/delete/reorder.
- Verification gates before done: `npm run typecheck`, `npm test`,
  `node scripts/scope-wall.mjs`.
- Per this session's dispatch (routed through the AGENTS.md-mandated
  Superpowers pipeline): commit only, do not release — the operator releases.
