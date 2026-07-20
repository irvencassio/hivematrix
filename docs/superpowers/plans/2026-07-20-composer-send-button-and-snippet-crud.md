# Composer Send Button Fix + Snippet CRUD/Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-07-20-composer-send-button-and-snippet-crud-design.md`
(extends `docs/superpowers/specs/2026-07-16-message-composer-snippets-design.md` /
`docs/superpowers/plans/2026-07-16-message-composer-snippets.md`, whose Task
Groups A and B already shipped — confirmed live in the file before writing
this plan). All work is in one file: `src/daemon/console.ts` (and its test
file `src/daemon/console.test.ts`). No other files change.

**Every task below is RED (write a failing test, run it, confirm it fails for
the expected reason) → GREEN (minimal code to pass) → re-run the full suite.**
Test code in this plan is illustrative of *intent*, not guaranteed byte-exact —
before using any test snippet below as your RED step, re-derive the exact
regex/assertion against the *real, current* content of `console.ts` (open the
file, confirm line numbers/exact strings still match what's written here).

Remember: this file's `<script>` block is raw JS parsed with `new Function()`
by an existing test — no TypeScript syntax (`as X`, `: Type`, `interface`,
generics) anywhere inside the `String.raw` template's script portion.

---

## Task Group D — Send button styling fix

### D1. RED: Send button uses the same class as Photo/Mic/Snippets

Current markup, `console.ts:7227`:
```
'<button class="create" id="flashSendBtn" onclick="event.stopPropagation();flashSend()" disabled>Send</button>'
```
Add a test to `console.test.ts` (near the existing `flashSendBtn` tests at
line ~2865/2907) asserting the button's class is `oc-mic-btn`, e.g.:
```ts
test("Send button matches Photo/Mic/Snippets styling (oc-mic-btn, not the unstyled .form-scoped .create)", () => {
  const js = extractScript(CONSOLE_HTML); // or search CONSOLE_HTML directly — confirm which the file's other flashSendBtn tests use
  assert.match(js, /<button class="oc-mic-btn" id="flashSendBtn"/, "Send button must share the oc-mic-btn pill styling used by the other three composer buttons");
  assert.doesNotMatch(js, /<button class="create" id="flashSendBtn"/, "old unstyled class must be gone");
});
```
Verify exactly where the other `flashSendBtn` tests (line ~2865, ~2907) pull
their string from (`CONSOLE_HTML` directly vs. an extracted script) and match
that convention rather than inventing a new one. Run and confirm this fails
because the live markup still says `class="create"`.

### D2. GREEN: swap the class

In `src/daemon/console.ts:7227`, change `class="create"` to `class="oc-mic-btn"`
on `flashSendBtn`. Leave every other attribute (`id`, `onclick`, `disabled`)
untouched — this is a pure styling fix, no behavior change. Re-run the new
test (GREEN) and the full suite (`npm test`) to confirm no regressions —
specifically re-check the existing tests at `console.test.ts:2865` and `:2907`
(`id="flashSendBtn"` presence, and `disabled` following it) still pass, since
neither depends on the class attribute.

No CSS changes needed — `.oc-mic-btn` (`console.ts:931-935`) already exists
and is already applied to Photo/Mic/Snippets.

---

## Task Group C — Snippet Create/Edit, Delete, Drag-reorder

(Renumbered from the 07-16 plan's own "Task Group C" — same scope, executed
now against the file's real current state. Depends on the already-shipped
storage layer (`DEFAULT_SNIPPETS`/`loadSnippets`/`saveSnippets`,
`console.ts:8648-8664`), modal shell (`#snippetsOverlay`, `console.ts:1613-1618`;
`openSnippetsModal`/`closeSnippetsModal`, `console.ts:8686-8692`), and list
rendering (`renderSnippetsList`/`snippetRowHtml`/`snippetPreview`,
`console.ts:8666-8684`) — re-read those live before starting, they are the
extension points below.)

Reusable patterns already in the file — don't reinvent:
- `.dialog-input` (`console.ts:485-486`) styles both `<input>` and
  `<textarea>` identically — reuse for the Name input and Text textarea, no
  new CSS.
- `.dialog-actions` / `.ok` / `.ok.danger` / `.cancel` (`console.ts:487-491`)
  — reuse for Save/Cancel buttons.
- `.flbl` — label class used throughout the settings/goal forms.
- `hmConfirm(message, opts)` (`console.ts:2276`) returns a Promise resolving
  truthy/falsy; `{okLabel, danger}` shape already used ~10 other places
  (e.g. `console.ts:4221`).
- `esc(s)` (`console.ts:2130`) — must wrap any user-authored string
  (`name`/`text`) before it lands in `innerHTML`.

### C1. RED + GREEN: Create / Edit view

Add a second view, `#snippetsEditView`, inside the same `#snippetsOverlay`
(no nested overlay), sibling to the existing list container. Wrap the current
list markup (the "+ Create" button and `#snippetsListBody`) in
`#snippetsListView` so the two views can be toggled via `style.display`.

Test first (RED): assert `#snippetsEditView` exists inside `#snippetsOverlay`
with a Name `.dialog-input`, a Text `.dialog-input` textarea, and
`.dialog-actions` Save/Cancel buttons; assert a `+ Create` button exists in
`#snippetsListView` wired to `openSnippetCreate()`; assert
`openSnippetCreate()`/`openSnippetEdit(id)`/`closeSnippetEdit()`/
`saveSnippetEdit()` are defined and toggle `#snippetsListView`/
`#snippetsEditView` `style.display`. Assert `saveSnippetEdit` rejects empty
name/text (pick disable-Save-button or `hmAlert` — be consistent, test
whichever you pick), and on valid input either appends a new snippet (create,
no `_snippetEditId` in flight) or updates in place by id (edit), then calls
`saveSnippets` and returns to list view via `renderSnippetsList()`. Assert
`closeSnippetEdit()` discards without calling `saveSnippets`.

Then implement to pass. Suggested shape (illustrative — re-derive against
live file, adjust ids/names to fit your test):

```html
<div id="snippetsListView">
  <button class="oc-mic-btn" style="margin-bottom:10px" onclick="openSnippetCreate()">+ Create</button>
  <div id="snippetsListBody"></div>
</div>
<div id="snippetsEditView" style="display:none">
  <label class="flbl">Name</label>
  <input class="dialog-input" id="snippetEditName" placeholder="Snippet name">
  <label class="flbl">Text</label>
  <textarea class="dialog-input" id="snippetEditText" rows="4" placeholder="Snippet text"></textarea>
  <div class="dialog-actions">
    <button class="cancel" onclick="closeSnippetEdit()">Cancel</button>
    <button class="ok" onclick="saveSnippetEdit()">Save</button>
  </div>
</div>
```

```js
let _snippetEditId = null;

function openSnippetCreate() {
  _snippetEditId = null;
  document.getElementById('snippetEditName').value = '';
  document.getElementById('snippetEditText').value = '';
  document.getElementById('snippetsListView').style.display = 'none';
  document.getElementById('snippetsEditView').style.display = '';
}
function openSnippetEdit(id) {
  const s = loadSnippets().find(function (x) { return x.id === id; });
  if (!s) return;
  _snippetEditId = id;
  document.getElementById('snippetEditName').value = s.name;
  document.getElementById('snippetEditText').value = s.text;
  document.getElementById('snippetsListView').style.display = 'none';
  document.getElementById('snippetsEditView').style.display = '';
}
function closeSnippetEdit() {
  _snippetEditId = null;
  document.getElementById('snippetsEditView').style.display = 'none';
  document.getElementById('snippetsListView').style.display = '';
}
async function saveSnippetEdit() {
  const name = document.getElementById('snippetEditName').value.trim();
  const text = document.getElementById('snippetEditText').value.trim();
  if (!name || !text) { await hmAlert('Name and text are both required.'); return; }
  const list = loadSnippets();
  if (_snippetEditId) {
    const ix = list.findIndex(function (x) { return x.id === _snippetEditId; });
    if (ix !== -1) list[ix] = Object.assign({}, list[ix], { name: name, text: text });
  } else {
    list.push({ id: 'snip-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8), name: name, text: text });
  }
  saveSnippets(list);
  closeSnippetEdit();
  renderSnippetsList();
}
```

Update `openSnippetsModal()` to call `closeSnippetEdit()` first (so a modal
left mid-edit from a prior open always reopens on the list view, matching
the existing "always renders current state, not stale DOM" behavior).

Add Edit control to each row in `snippetRowHtml` (Delete lands in C2 — do
both row-button additions together since they touch the same function, but
keep them as clearly separable edits): row click still inserts; the Edit
button must `event.stopPropagation()` so it doesn't also trigger insert.

### C2. RED + GREEN: Delete with confirmation

Test + implement: a `deleteSnippet(id)` function, wired from a Delete control
on each row (`event.stopPropagation()` on click, same reason as Edit), that
calls `hmConfirm('Delete snippet "' + esc(name) + '"?', {okLabel:"Delete",
danger:true})`, and only on a truthy resolution filters that snippet out of
the array, calls `saveSnippets`, and re-renders via `renderSnippetsList()`.

```js
async function deleteSnippet(id) {
  const list = loadSnippets();
  const s = list.find(function (x) { return x.id === id; });
  if (!s) return;
  const ok = await hmConfirm('Delete snippet "' + esc(s.name) + '"?', { okLabel: 'Delete', danger: true });
  if (!ok) return;
  saveSnippets(list.filter(function (x) { return x.id !== id; }));
  renderSnippetsList();
}
```

Test at the function-body-assertion level (`fnBody`/`extractFunctionBlock`),
matching this file's existing no-jsdom style — assert the `hmConfirm` call
shape and that the filter+save+render only happen after an awaited truthy
value (structurally: after the `if (!ok) return;` guard).

### C3. RED + GREEN: Drag-to-reorder

Test + implement native HTML5 DnD on each row via `dragstart`/`dragover`/`drop`
attributes added to `snippetRowHtml`'s row `<div>`. A closure-scoped variable
(module-level, e.g. `_snippetDragSrc`) records the dragged id; `drop` splices
the array to the new position and persists immediately.

```js
let _snippetDragSrc = null;
function snippetDragStart(e, id) { _snippetDragSrc = id; e.dataTransfer.effectAllowed = 'move'; }
function snippetDragOver(e) { e.preventDefault(); }
function snippetDrop(e, targetId) {
  e.preventDefault();
  if (_snippetDragSrc == null || _snippetDragSrc === targetId) return;
  const list = loadSnippets();
  const fromIx = list.findIndex(function (x) { return x.id === _snippetDragSrc; });
  const toIx = list.findIndex(function (x) { return x.id === targetId; });
  if (fromIx === -1 || toIx === -1) return;
  const moved = list.splice(fromIx, 1)[0];
  list.splice(toIx, 0, moved);
  saveSnippets(list);
  _snippetDragSrc = null;
  renderSnippetsList();
}
```
Row template gains `ondragstart="snippetDragStart(event,'ID')"
ondragover="snippetDragOver(event)" ondrop="snippetDrop(event,'ID')"` (row
already has `draggable="true"` from the 07-16 work — confirm still present).

Test this at the function-body-assertion level: handlers wired with the
right event names on the row template, `dragover`/`drop` call
`preventDefault()`, `drop` splices via `findIndex`+`splice` and calls
`saveSnippets`, matching the file's existing no-jsdom test style (see
`console.test.ts:3897-3910`'s `insertSnippet` test for the exact shape of
assertion this file uses for DOM-adjacent logic).

---

## Finishing

1. `npm run typecheck` — zero errors.
2. `npm test` — full suite green, including every new test above and all
   pre-existing tests (especially `console.test.ts:2865`, `:2907`,
   `:3803-3910`).
3. `node scripts/scope-wall.mjs` — zero violations (no new persistent store,
   no forbidden-brand string — should be a clean no-op check).
4. Two commits:
   - `fix(console): Send button matches Photo/Mic/Snippets styling`
     (Task Group D only).
   - `feat(console): snippet create/edit/delete/drag-reorder`
     (Task Group C).
5. Per this session's dispatch, routed through the AGENTS.md-mandated
   Superpowers pipeline: commit only. Do not push, do not release — the
   operator handles both.
