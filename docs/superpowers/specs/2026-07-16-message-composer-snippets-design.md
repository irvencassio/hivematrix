# Message Composer: Taller Input + Prompt Snippets — Design

> Non-interactive self-improvement session. Requirements arrived fully specified
> by the dispatch; no open design questions needed operator input. Self-approved
> after the standard brainstorming pass below — see AGENTS.md's Superpowers
> pipeline and the self-improvement loop's non-interactive constraint.

## Context

- `.oc-panel-composer-shell` (`src/daemon/console.ts` ~886-923) is a CSS grid
  (`minmax(0,1fr) 88px`) with `align-items:end` — the `<textarea id="flashInput">`
  and the button stack (`Photo`, `Mic`, `Send`) are independent grid items,
  bottom-aligned. The row height is already driven by the taller column (the
  button stack), but the textarea doesn't stretch to fill it — it sits at its
  own intrinsic ~64px height with dead space above it.
- No React/Vue/build step. `console.ts` exports `CONSOLE_HTML`, a single
  `String.raw` template containing all HTML+CSS+client JS, served directly by a
  plain `http.createServer` daemon at `/console`. All interactivity is vanilla
  DOM JS (`onclick=` attributes, `document.getElementById`, direct
  `.innerHTML` writes). The file's own header comment: *"structured to migrate
  to a Next.js app... later — the data contract is the daemon API, not this
  file."* Not our job to change that now.
- `console.test.ts` asserts against the raw string via regex, plus
  `extractScript`/`extractFunctionBlock`/`fnBody`/`extractBetween` helpers, plus
  a `new Function(js)` parse check that catches TypeScript-only syntax leaking
  into the string (the script block is NOT type-checked by `tsc` — only this
  runtime parse test catches e.g. a stray `as HTMLTextAreaElement`). This
  string-based approach is this project's deliberately-chosen test harness for
  `console.ts`, not a gap to fill with something heavier.
- Existing modal pattern: `.overlay`/`.modal`, e.g. the Observability modal
  (`#obsOverlay` / `openObsModal()` / `closeObsModal()`, commit `3420c169`) —
  backdrop-click-to-close (`onclick="if(event.target===this)close...()"`),
  explicit `<span class="x">✕</span>` close button, `classList.add/remove('open')`.
- Existing confirm pattern: `hmConfirm(message, opts)` — Promise<boolean>,
  in-DOM replacement for native `confirm()` (WKWebView's native one doesn't
  work). `opts.danger` red-styles the OK button, `opts.okLabel` customizes it.
- Existing localStorage pattern: direct `getItem`/`setItem`, `hm_`-prefixed
  keys, `JSON.stringify`/`parse` for structured data, wrapped in `try/catch`
  (e.g. `hm_lanes_collapsed`, `hm_col_left`).
- Existing escape helper: `esc(s)` — must be reused for any snippet name/text
  rendered into `innerHTML` (XSS hygiene; a snippet body is user-authored text
  that could contain `<`/`>`/`&`).
- No drag-to-reorder precedent anywhere in the codebase (confirmed by search).
  Native HTML5 Drag and Drop (`draggable`, `dragstart`, `dragover`, `drop`) is
  already used for the image-attach drop zone — reuse that primitive rather
  than adding a sortable-list dependency.

## Goals (from dispatch)

1. Composer textarea visually matches the button stack's height.
2. A "Snippets" button opens a modal to manage reusable prompt snippets
   (create/edit/delete/reorder), inserting the clicked snippet's text at the
   cursor position in the message box.

## Non-goals

- No server-side/DB persistence for snippets — spec explicitly says local
  storage, matching every other per-device UI preference in this file.
- No fix for the pre-existing, unrelated `Send` button under-styling (it's
  missing the `.oc-mic-btn` class and falls back to browser-default button
  chrome — a real, separate bug, not mentioned in this dispatch). Flagging it
  here, not fixing it, to avoid scope creep into an unreviewed area.
- No touch/mobile drag support beyond what native HTML5 DnD gives for free —
  this app's runtime is a desktop Tauri/WKWebView shell.

## Feature 1 — Taller composer

**Approach:** two CSS changes in `console.ts` (~886-923):

1. `.oc-panel-composer-shell`: `align-items:end` → `align-items:stretch`, so
   the textarea fills the grid row's height (already set by the taller
   button-stack column) instead of bottom-aligning at its own intrinsic size.
2. `.oc-input`: `min-height:64px` → `min-height:88px` — a reasonable floor
   independent of stretch. `max-height:180px` stays as-is (still respected;
   stretch only affects the base height within the grid row).

**Alternatives considered and rejected:**
- JS-measured height sync (measure the button stack, set textarea height in
  JS): unnecessary — CSS grid already expresses "fill the row" declaratively.
- Flexbox rewrite of the shell: the column layout (`minmax(0,1fr) 88px`) is
  already correct; only cross-axis alignment is wrong. No need to change the
  layout model for a one-property fix.

**Interaction with Feature 2:** adding a 4th button to the action stack grows
its natural height (existing `flex-direction:column; gap:7px`); with
`align-items:stretch` the textarea automatically grows to match — no extra
work needed when the Snippets button is added.

## Feature 2 — Prompt Snippets

**Storage:** `localStorage['hm_snippets']` = JSON array of `{id, name, text}`.
Array order **is** the display/insert/reorder order — no separate ordering
field to keep in sync; reordering is an array splice. Seed with the spec's
four example snippets (`Check status`, `Summarize findings`, `What's the next
step?`, `Can you break this down?`) only when the key is entirely absent
(first run). Once the user has ever saved — including deleting down to zero —
an empty or edited array is respected as-is and never re-seeded.

**Modal:** new `.overlay`/`.modal` instance, `#snippetsOverlay`, structurally
identical to the Observability modal (backdrop click-to-close, explicit ✕,
`open`/`close` JS pair: `openSnippetsModal()` / `closeSnippetsModal()`). Two
views swapped inside the same modal — no nested overlay-on-overlay:

- **List view** (default on open): each snippet is a row showing `esc(name)`
  + a truncated, `esc()`-escaped preview of `text`; `draggable="true"` for
  reorder; per-row Edit/Delete icon-buttons; a top-level "+ Create" button;
  ✕/backdrop to close (= spec's "Cancel" — closes without inserting).
- **Edit view** (Create or Edit): Name text input + Text textarea, Save/Cancel.
  Cancel returns to list view, discarding changes, without touching storage.

**Insert-at-cursor:** clicking a snippet row (not its Edit/Delete controls) in
list view splices `snippet.text` into `flashInput.value` at
`selectionStart`/`selectionEnd` (replacing any active selection — normal
textarea paste semantics), closes the modal, refocuses `flashInput`, and sets
`selectionStart = selectionEnd = insertionPoint + snippet.text.length` so the
cursor lands immediately after the inserted text (spec: "cursor position
maintained for further editing"). Calls the existing `flashInputResize()`
afterward so the box grows if the inserted text is long.

**Delete confirmation:** reuse `hmConfirm(`Delete snippet "${esc(name)}"?`,
{okLabel:"Delete", danger:true})` — already exactly this shape. No new confirm
UI.

**Drag-to-reorder:** native HTML5 DnD on each list-view row. `dragstart`
records the dragged index in a closure variable (same-page, same-list drag
only — no need for `dataTransfer` payload machinery); `dragover` calls
`preventDefault()` (required to allow a drop) and tracks the hovered index;
`drop` splices the array to the new position, re-renders the list, and
persists to `localStorage`.

**Button placement:** a 4th `.oc-mic-btn`-styled button in
`.oc-panel-composer-actions`, id `flashSnippetsBtn`, label `{} Snippets`
(matches the existing emoji/icon + text convention of `📎 Photo` / `🎤 Mic`),
`onclick="event.stopPropagation();openSnippetsModal()"` (matches the existing
`stopPropagation` pattern on Photo/Mic so it doesn't also trigger the shell's
own `onclick="flashFocusInput()"`).

## Complexity budget accounting (AGENTS.md Q14)

- New persistent store: **none** — localStorage only, the same mechanism as
  the ~7 existing `hm_*` preference keys. Not a `CREATE TABLE`; no DECISIONS.md
  entry needed.
- New product concept: prompt snippets are a UI preference (like collapse
  state / column widths), not a new orchestration primitive — doesn't touch
  the Event/Task/Directive/Policy/Persona kernel. No DECISIONS.md entry
  required, by the same reasoning existing per-view prefs didn't need one.

## Testing strategy

Follow `console.test.ts`'s established convention exactly — regex/string
assertions against `CONSOLE_HTML` and the extracted `<script>` body via the
existing `extractScript`/`extractFunctionBlock`/`fnBody`/`extractBetween`
helpers. This is the project's deliberately-chosen verification harness for
`console.ts` (see the file's own "no TypeScript leaks" test rationale) — not a
gap to fill with a browser/DOM test runner. New tests will assert:

- CSS: `align-items:stretch` on `.oc-panel-composer-shell`; `min-height:88px`
  on `.oc-input`.
- Markup: Snippets button exists with the right id/label/onclick;
  `#snippetsOverlay` markup exists with backdrop-click-close, matching the
  Observability modal's structural pattern.
- JS: `openSnippetsModal`/`closeSnippetsModal` exist and touch the right ids;
  the default-seed array contains the four spec example snippets; the insert
  path reads/writes `selectionStart`/`selectionEnd` and calls
  `flashInputResize`; the render path calls `esc()` on name and preview; the
  delete path calls `hmConfirm` with `danger:true`; `dragstart`/`dragover`/
  `drop` handlers are wired on the row template; storage reads/writes go
  through `hm_snippets` wrapped in `try/catch`, matching the existing pattern.
- No-TS-leak guard: all new JS lives inside the `String.raw` block, so it must
  be plain JS — no `as X` casts, `: Type` annotations, `interface`, generics.
  The existing "console browser script is valid JavaScript" test catches
  violations, but write correct JS proactively rather than relying on it.

## Rollout

- Two commits: (1) composer height CSS fix, (2) prompt snippets feature —
  independently reviewable, matching AGENTS.md's "small, well-tested diffs."
- Verification gates before done: `npm run typecheck`, `npm test`,
  `node scripts/scope-wall.mjs`.
- Commit to `main`, then `git push origin main` — the dispatch explicitly asks
  for push ("Commit and push to main. No build at this time"). No release
  (build/sign/notarize/publish) — that stays the operator's call.
