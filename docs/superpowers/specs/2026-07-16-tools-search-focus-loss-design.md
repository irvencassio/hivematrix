# Tools Panel Search Box Focus Loss — Design

## Problem

`toolsQueryInput()` (`src/daemon/console.ts` ~7801) fires on every `oninput` event
from `#toolsQuery` and calls `renderToolsPanel()` unconditionally. `renderToolsPanel()`'s
non-error branch does a full `session.innerHTML = '<div class="oc-center-pane">' + ...`
(~line 7790), which **replaces the entire Tools panel subtree — including the
`<input id="toolsQuery">` node itself — on every keystroke**.

The typed text isn't lost (`_toolsQuery` is read from the live input before the render
and written back as the new input's `value` attribute), but the DOM node the browser was
focusing no longer exists after the replacement; a brand-new, unfocused `<input>` takes
its place. Result: type one character, focus silently reverts to nothing, and the
operator must re-click the box to type the next character. Confirmed by reading the
render path directly (not just inferred from the dispatch's own hypotheses) — this is
the standard "full re-render on every keystroke destroys the focused node" pattern,
matching the dispatch's own hypothesis #2 ("component re-rendering on state change,
losing focus on each keystroke").

**Not a duplicate of the 2026-07-16 alignment fix** (`known-issues.md`, commit
`7fa45ca4`): that fix only moved *where* the `.sk-toolbar`/`#toolsQuery` block sits in
the markup string. It didn't touch the fact that `renderToolsPanel()` fully replaces
`#session`'s subtree on every call — that behavior predates that commit and is the
actual mechanism behind this bug. Checked `known-issues.md` and `git log` first — no
prior "focus" report exists; this is genuinely new work, not a reworded repeat.

**Bonus related case, same mechanism:** `loadCapabilities()` also calls
`renderToolsPanel()` unconditionally when its async fetch resolves (~line 7684). If an
operator starts typing in the brief window before the initial capabilities fetch
resolves, that resolution would blow away focus the same way, independent of any
keystroke. The fix below closes both call sites at once because it changes
`renderToolsPanel()` itself, not just the `oninput` handler — no caller needs to know
about focus at all.

## Options considered

1. **Restore focus/selection after every full re-render** (save `document.activeElement`,
   cursor position, and selection range before `session.innerHTML = ...`, then re-apply
   to the new node afterward). Rejected — treats the symptom, not the cause. Every
   future caller of `renderToolsPanel()` would need to remember focus can be clobbered,
   and cursor/selection restoration on a freshly-parsed node is fiddly (`setSelectionRange`
   timing, IME composition state, etc.) for something a structural fix avoids needing at
   all.

2. **Stop fully replacing the shell once it's already mounted — update only the results
   pane (`.tools-pane`) in place, leaving the input node untouched.** Chosen.
   `renderToolsPanel()` gains a cheap guard: if `#toolsQuery` and `.tools-pane` already
   exist in the live DOM (i.e. this isn't the first render since the panel opened, or a
   transition out of the error state), write the newly-computed `body` string directly
   into the existing `.tools-pane` node's `innerHTML` and return — never touching the
   input, so the browser's native focus/cursor/selection state on it is left completely
   alone. Nothing needs to "restore" it because nothing ever takes it away. The
   first-ever render for a given panel-open still does the existing full replace, since
   no prior shell exists yet to update in place.

3. **Debounce `toolsQueryInput()`** (delay the re-render ~150ms after the last
   keystroke). Rejected — doesn't fix the bug, just shrinks its window. A fast typist or
   a slow render still gets bounced out mid-word, and it adds a timer/concept for
   something a structural fix removes outright.

## Scope

`renderToolsPanel()` only, in `src/daemon/console.ts`. No changes to
`toolsQueryInput()`, `toggleToolExpand()`, or `loadCapabilities()` — they all already
just call `renderToolsPanel()` and get the fix automatically, since the smarter branch
lives inside the one function every caller already goes through. No CSS changes. No
changes to the error-state branch (it has no search box, nothing to preserve there).

## Explicitly out of scope (noted for a future pass, not actioned here)

- Cursor *position* within the input (e.g. if a future change needed to move the caret
  programmatically) — not needed here since the node is never touched at all once
  mounted, so the browser's native caret/selection handling is untouched by
  construction.
- The same "full re-render on state change" pattern likely exists in other panels
  (Chat/Goals/Roles/Brain) wherever they have live inputs — not audited here; this
  dispatch is scoped to the Tools panel's reported bug only. Worth a follow-up sweep if
  the same symptom is ever reported elsewhere.
- Debounce/throttle of the *filtering* work itself (recomputing `visibleGroups` on every
  keystroke) — not a reported perf problem, no evidence of jank, out of scope.
- **Test-strength caveat:** this repo's test suite (`console.test.ts`) has no jsdom or
  equivalent live-DOM dependency — every existing test on `renderToolsPanel()` is a
  static regex/substring assertion against the extracted function source, not a real
  render-and-simulate-a-keystroke test. The new test this plan adds is the same kind: it
  proves the source takes the intended structural shape (guard-then-reuse before the
  full-replace fallback), not a live assertion that `document.activeElement` survives a
  keystroke. That's a real (if unavoidable, given existing infra) limitation worth
  naming rather than writing a test that reads as stronger than it is.
