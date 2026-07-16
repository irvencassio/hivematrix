# Message Composer: Taller Input + Prompt Snippets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-07-16-message-composer-snippets-design.md`
All work is in one file: `/Users/irvcassio/hivematrix/src/daemon/console.ts` (and
its test file `src/daemon/console.test.ts`). No other files change.

**Every task below is RED (write a failing test, run it, confirm it fails for
the expected reason) → GREEN (minimal code to pass) → re-run the full suite.**
Test code in this plan is illustrative of *intent*, not guaranteed byte-exact —
before using any test snippet below as your RED step, re-derive the exact
regex/assertion against the *real, current* content of `console.ts` (open the
file, confirm line numbers/exact strings still match what's written here; this
file may drift). A prior session on this same project had a subagent catch two
real bugs (a case-sensitivity typo, an `indexOf()` matching the wrong
occurrence) in plan-authored test code that would have made a test permanently
unpassable — don't paste this plan's code on trust.

Remember: this file's `<script>` block is raw JS parsed with `new Function()`
by an existing test — no TypeScript syntax (`as X`, `: Type`, `interface`,
generics) anywhere inside the `String.raw` template's script portion.

---

## Task Group A — Taller composer

### A1. RED: composer stretches to match button-stack height

Add to `src/daemon/console.test.ts` (near other composer-CSS assertions):

```ts
test("composer textarea stretches to match the button stack's height", () => {
  const shellCss = extractBetween(CONSOLE_HTML, ".oc-panel-composer-shell {", "}");
  assert.match(shellCss, /align-items:\s*stretch/, "shell must stretch children, not bottom-align them");
  const inputCss = extractBetween(CONSOLE_HTML, ".oc-input {", "}");
  assert.match(inputCss, /min-height:\s*88px/, "textarea floor height raised to better match the 4-button stack");
});
```

Verify the exact current CSS block delimiters (`.oc-panel-composer-shell {` /
`.oc-input {` and their current property values) against the live file before
trusting the snippet above — `extractBetween` is defined in
`console.test.ts` already (used by other tests in the file); confirm its
exact signature there. Run `npm test -- --test-name-pattern "stretches"` (or
equivalent) and confirm it fails because `align-items:end` (not `stretch`) and
`min-height:64px` (not `88px`) are what's actually present.

### A2. GREEN: make the CSS change

In `src/daemon/console.ts`, in the `.oc-panel-composer-shell` rule: change
`align-items:end` to `align-items:stretch`. In the `.oc-input` rule: change
`min-height:64px` to `min-height:88px`. Leave `max-height:180px` and every
other property untouched. Re-run the new test (GREEN) and the full suite
(`npm test`) to confirm no regressions — check specifically for any other test
asserting the literal string `align-items:end` or `min-height:64px` on these
selectors (grep `console.test.ts` for both strings first) and update it if it
exists, rather than leaving a contradictory assertion behind.

---

## Task Group B — Prompt Snippets (storage, button, modal shell, list view, insert-at-cursor)

### B1. RED: default snippets + storage round-trip

The four seed snippets (exact spec text): `"Check status"`, `"Summarize
findings"`, `"What's the next step?"`, `"Can you break this down?"`.

Add a test asserting the compiled script defines a `DEFAULT_SNIPPETS`-like
array (name may differ — search for how you actually name it once B2 is
written; write this test to match your own GREEN implementation's real
identifier, don't invent one in isolation) containing those four strings, and
a save/load pair that reads/writes `localStorage['hm_snippets']` as JSON,
wrapped in `try/catch` (matching `hm_lanes_collapsed`'s existing pattern —
read that pattern in the live file first).

### B2. GREEN: storage layer

Add to the script portion of `CONSOLE_HTML`:
- A `DEFAULT_SNIPPETS` array of `{id, name, text}` for the four seed snippets
  (generate stable ids, e.g. `"seed-1"`.."seed-4" — must be stable across
  reloads so drag-reorder persistence round-trips correctly, don't use
  `Math.random()`/timestamp-based ids for the seeds).
- `loadSnippets()`: read `localStorage['hm_snippets']`; if absent, return
  `DEFAULT_SNIPPETS` (do not write it back yet — only persist on first real
  save, so a user who never opens the modal never gets a stray write); if
  present, `JSON.parse` and return it; wrap in `try/catch` returning
  `DEFAULT_SNIPPETS` on parse failure (matches existing defensive pattern).
- `saveSnippets(list)`: `JSON.stringify` and `localStorage.setItem`, wrapped
  in `try/catch` (matches existing pattern — swallow quota/serialization
  errors rather than throwing into an onclick handler).

### B3. RED: Snippets button + modal shell markup

Test that `flashPanelHtml()`'s composer-actions block contains a 4th button:
id `flashSnippetsBtn`, class `oc-mic-btn`, `onclick="event.stopPropagation();openSnippetsModal()"`,
placed after Mic and before/after Send per your judgment (spec says "next to
Photo/Mic buttons" — Photo, Mic, Snippets, Send is a reasonable reading; Send
stays last since it's the primary action). Test that `CONSOLE_HTML` contains
a `#snippetsOverlay` `.overlay`/`.modal` block matching the Observability
modal's structural pattern (backdrop-click-close via
`onclick="if(event.target===this)closeSnippetsModal()"`, explicit
`<span class="x" onclick="closeSnippetsModal()">✕</span>`), and that the
script defines `openSnippetsModal()` / `closeSnippetsModal()` following the
same `classList.add('open')` / `classList.remove('open')` shape as
`openObsModal`/`closeObsModal` (read those first, mirror the shape, don't
reinvent it).

### B4. GREEN: button + modal shell

Implement per B3's assertions. `openSnippetsModal()` should render the list
view (call the list-render function from B5/B6) each time it opens, so it's
always showing current storage state, not stale DOM from a previous open.

### B5. RED + GREEN: list view rendering (read-only display first)

Test: a render function takes the snippets array and produces a row per
snippet showing `esc(name)` and an `esc()`-escaped, truncated preview of
`text` (pick a truncation length, e.g. 60 chars + `…` if longer — assert the
truncation behavior with a >60-char fixture string, and assert a short string
is shown in full, un-ellipsized). Assert each row carries `draggable="true"`
and a `data-` attribute or similar identifying its snippet id (needed by B7's
drag handlers and B6's click-to-insert/edit/delete dispatch). Implement to
pass. This step is display-only — no click behavior yet.

### B6. RED + GREEN: insert-at-cursor on row click

Test: clicking a row (not its Edit/Delete controls) calls a function that:
reads `flashInput.selectionStart`/`selectionEnd`, splices the snippet's
`text` into `flashInput.value` at that range (replacing any selection),
closes the modal (`closeSnippetsModal()`), calls `flashInput.focus()`, sets
both `selectionStart` and `selectionEnd` to `insertionPoint + text.length`,
and calls the existing `flashInputResize(flashInput)` (confirm that
function's real name/signature in the live file first — it's referenced in
the design doc as already existing). Write this as a assert-on-function-body
test (`fnBody`/`extractFunctionBlock`) checking for
`selectionStart`/`selectionEnd`/`flashInputResize` — not a live-DOM
simulation, matching this file's existing test style (no jsdom in this repo;
confirm that's still true before assuming it — grep `package.json` deps and
`console.test.ts`'s imports for `jsdom`/`happy-dom` first).

---

## Task Group C — Create/Edit, Delete, Drag-reorder

Depends on Task Group B being complete (extends the list view and modal it
built). Run this as a separate subagent turn *after* B is GREEN and its tests
pass — don't start C against a stale/imagined version of B's output; re-read
the actual state of `console.ts` first.

### C1. RED + GREEN: Create / Edit view

Test + implement an inline edit view swapped into `#snippetsOverlay` (same
overlay, not a second overlay — re-read the design doc's "no nested
overlay-on-overlay" decision): Name `<input>` + Text `<textarea>`, Save and
Cancel controls. "+ Create" button in list view opens this view empty; each
row's Edit control opens it pre-filled with that row's `name`/`text`. Save
validates non-empty name and text (decide and test the exact empty-input
behavior — e.g. disable Save or show `hmAlert` — pick one and be consistent),
appends (create) or updates in-place (edit, matched by id) in the snippets
array, calls `saveSnippets`, re-renders list view. Cancel discards in-progress
edits and returns to list view without calling `saveSnippets`.

### C2. RED + GREEN: Delete with confirmation

Test + implement: each row's Delete control calls
`hmConfirm('Delete snippet "' + esc(name) + '"?', {okLabel:"Delete", danger:true})`
(await the promise — confirm `hmConfirm`'s real call signature against the
live file first, per the design doc), and only on a truthy resolution removes
that snippet from the array, saves, and re-renders.

### C3. RED + GREEN: Drag-to-reorder

Test + implement native HTML5 DnD on each row: `dragstart` records the
dragged snippet's index in a closure variable; `dragover` calls
`event.preventDefault()` (required for `drop` to fire) and determines the
hover target's index; `drop` splices the array (remove from old index, insert
at new index), calls `saveSnippets`, re-renders. Test this at the
function-body-assertion level (handlers wired with the right event names and
calling `preventDefault`/splice/`saveSnippets`), matching the file's existing
no-jsdom test style.

---

## Finishing

1. `npm run typecheck` — zero errors.
2. `npm test` — full suite green, including every new test above.
3. `node scripts/scope-wall.mjs` — zero violations (this feature adds no new
   persistent store or forbidden-brand string, so this should be a clean
   no-op check, not a fight).
4. Two commits:
   - `feat(console): composer textarea stretches to match button-stack height`
     (Task Group A only).
   - `feat(console): prompt snippets — create/edit/delete/reorder, insert at cursor`
     (Task Groups B + C).
5. `git push origin main` (the dispatch explicitly asked for this — see the
   design doc's Rollout section). No build, no release.
