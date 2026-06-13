# Console Reply Draft Preservation Design

## Context

The task detail pane is rebuilt by `selectTask()`. `refresh()` runs on a timer
and in response to SSE events, and calls `selectTask(state.selected)` when a task
is selected.

For tasks in `review · needs_input`, the reply textarea is rendered inside that
rebuilt HTML. If refresh lands while the user is typing, the textarea is replaced
and the draft disappears.

## Goals

1. Preserve retry/reply draft text across same-task live refreshes.
2. Preserve existing attachment behavior across same-task live refreshes.
3. Clear draft text when switching tasks or after a successful submit.
4. Keep the change local to the raw console script.

## Non-Goals

- Do not alter task reply API semantics.
- Do not debounce or disable live refresh globally.
- Do not persist unsent reply drafts to disk.

## Selected Design

Store retry/reply drafts in the same local console state bucket as retry/reply
attachments. On each same-task refresh, sync the current DOM textarea value
before rebuilding the detail pane, then restore it after `innerHTML` replacement.

This keeps live updates flowing while removing the user-visible text loss.

## Verification

- Add console regression coverage that the raw script wires `onCtxDraft`,
  `syncCtxDrafts`, and `restoreCtxDrafts`.
- Keep the browser-script syntax test green.
- Run `npm test`, `npm run typecheck`, and `node scripts/scope-wall.mjs`.
