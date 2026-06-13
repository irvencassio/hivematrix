# Console Reply Draft Preservation Design

## Context

The task detail pane is rebuilt by `selectTask()`. `refresh()` runs on a timer
and in response to SSE events, and calls `selectTask(state.selected)` when a task
is selected.

For tasks in `review · needs_input`, the reply textarea is rendered inside that
rebuilt HTML. If refresh lands while the user is typing, the textarea is replaced.
The original fix preserved draft text, but the replacement textarea still lost
focus and caret position, so typing could continue nowhere after only a few
words.

## Goals

1. Preserve retry/reply draft text across same-task live refreshes.
2. Preserve existing attachment behavior across same-task live refreshes.
3. Preserve focus and selection/caret position across same-task live refreshes.
4. Clear draft text when switching tasks or after a successful submit.
5. If a task is marked `needs_input` but its structured pending request has already disappeared, treat a console reply as operator continuation guidance and requeue the task instead of showing a dead-end error.
6. Do not restore retry/reply focus when the operator has moved focus outside the task detail pane, such as into the new-task composer.
5. Keep the change local to the raw console script.

## Non-Goals

- Do not alter task reply API semantics.
- Do not debounce or disable live refresh globally.
- Do not persist unsent reply drafts to disk.
- Do not require a stuck-request sidecar file for every console reply; stale `needs_input` tasks still need a recovery path.
- Do not let task-detail refreshes steal focus from the task composer or other controls outside `#session`.

## Selected Design

Store retry/reply drafts in the same local console state bucket as retry/reply
attachments. On each same-task refresh, sync the current DOM textarea value
and active selection before rebuilding the detail pane, then restore the value,
focus, and caret/selection after `innerHTML` replacement.

This keeps live updates flowing while removing the user-visible text loss.

## Verification

- Add console regression coverage that the raw script wires `onCtxDraft`,
  `syncCtxDrafts`, `restoreCtxDrafts`, and active context focus restoration.
- Keep the browser-script syntax test green.
- Run `npm test`, `npm run typecheck`, and `node scripts/scope-wall.mjs`.
