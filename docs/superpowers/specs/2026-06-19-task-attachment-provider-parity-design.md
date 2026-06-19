# Task Attachment Provider Parity Design

## Context

HiveMatrix tasks can include "Attached files" in the task description. The
desktop console currently builds that block from the browser file input value:
`File.path || File.name`. In the Tauri/WebView console, `File.path` is not
reliably present, so a task can be created with only a display filename such as
`Screenshot 2026-06-19 at 9.08.33 AM.png`.

The scheduler passes the task description unchanged into the runner layer:
Claude receives it as the Claude Code prompt, Codex/ChatGPT receives it after
the Codex routing preamble, and Qwen/local receives it as the user chat message.
When the description contains only a filename, all providers lack a readable
path. The screenshotted failure shows Claude searching `/private/tmp` and common
user folders because HiveMatrix did not tell it where the attachment was stored.

HiveMatrix already has a `/uploads` endpoint and `saveUpload()` store that
writes uploaded bytes under `~/.hivematrix/uploads` and returns a Mac-local
absolute path. Remote clients use this because their original file paths are not
readable on the Mac. The desktop console should use the same stable path model.

## Goals

1. Copy every task attachment selected in the console into
   `~/.hivematrix/uploads` before it is referenced by a task.
2. Store and display the returned absolute local path, while preserving the
   original filename for human readability.
3. Format attachment instructions through one shared helper for new tasks,
   retry guidance, and replies.
4. Make the provider-facing instruction explicit: agents must read attachments
   from the listed absolute paths on disk.
5. Keep behavior provider-neutral so Claude, ChatGPT/Codex, and Qwen/local all
   receive the same attachment guidance through the task description.
6. Preserve existing remote upload behavior and safe filename filtering.

## Non-Goals

- Do not add provider-specific attachment APIs or branches.
- Do not alter model routing, scheduler selection, or Qwen readiness logic.
- Do not make the agent infer attachment locations from common folders.
- Do not store attachment bytes in the SQLite task row.
- Do not require original local files to remain in place after task creation.

## Selected Approach

Use the existing upload store as the canonical attachment path for all console
attachments. When the operator selects files in the desktop console, the console
will read each file with `FileReader`, POST its base64 payload to `/uploads`,
and keep the returned record in local attachment state. Attachment chips will
show the original filename and expose the copied absolute path in the tooltip.

Task creation, retry guidance, and replies will use a small shared formatter
that renders a consistent block:

```text
Attached files:
- Original Name.png
  path: /Users/<user>/.hivematrix/uploads/<id>-Original_Name.png

Use the absolute path above to read each attachment from disk. Do not search for
the original filename in the working directory.
```

If the input is already an absolute path from an older caller, the helper will
still render it as a readable path. If the input includes both filename and path,
the helper will render both. This keeps existing mobile/remote clients
compatible while giving the console a stronger path.

## Data Flow

1. Operator selects one or more files in the console.
2. Console reads each file as a data URL.
3. Console posts `{ filename, dataBase64 }` to `POST /uploads`.
4. The daemon writes the bytes under `~/.hivematrix/uploads` and returns
   `{ path, filename, bytes }`.
5. Console stores attachment records in the relevant local state bucket:
   new task, retry, or reply.
6. On submit, the console sends either the normalized attachment records or a
   description already formatted by the shared browser-side formatter.
7. The task description contains absolute local paths before the scheduler
   spawns any provider.
8. Claude, ChatGPT/Codex, and Qwen/local receive the same task description and
   can read the copied files from disk.

## Components

### Shared Attachment Formatter

Add a small formatter in `src/lib/tasks/attachments.ts` for server-side tests
and for retry/reply server paths. It will normalize strings and object records
into attachment entries, render the readable block, and avoid duplicate paths.

The browser console cannot import TypeScript modules from inside the raw
`String.raw` HTML, so it will include a matching small browser helper. The
server helper remains the source of behavior for unit tests and API-side
formatting.

### Console Upload State

Replace raw `_attachPaths` strings with attachment records:

```ts
{
  path: "/Users/irvcassio/.hivematrix/uploads/abc-Screenshot.png",
  filename: "Screenshot.png",
  bytes: 12345
}
```

Use the same record shape for retry and reply attachments. While uploads are in
flight, show a clear inline "Uploading..." state and disable submit buttons so
tasks are not created with incomplete attachment paths.

### API Compatibility

`POST /uploads` stays unchanged. `POST /tasks` can continue accepting a
description string; the console may submit the fully formatted description.

Retry and reply endpoints should accept attachment records as well as legacy
string paths. This lets future clients send structured attachments without
having to duplicate formatting in every UI.

## Error Handling

- If an upload fails, keep the task form open and show an inline error. Do not
  create the task with only the original filename.
- If a selected file is empty or rejected by `/uploads`, show the daemon error.
- If an attachment record is missing a path, render only the original label and
  clearly mark the path as unavailable; this path should not occur in the normal
  console flow.
- Safe filename and extension filtering remain in `saveUpload()`.

## Testing

- Add unit tests for the attachment formatter:
  - object record with filename/path renders both;
  - absolute string path renders a readable path;
  - duplicate paths are de-duplicated;
  - the block includes explicit disk-reading guidance.
- Add raw console script tests that:
  - new-task attachments upload through `/uploads`;
  - console no longer relies on `File.path || File.name` as the final task path;
  - retry/reply attachment states use the same upload/format path;
  - the browser script remains valid JavaScript.
- Add provider prompt tests showing:
  - Claude prompt includes the formatted attachment block;
  - Codex prompt includes the same block after its routing preamble;
  - Qwen/local generic messages include the same block as the user content.
- Run `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
- Run `npx tsx scripts/qwen-readiness.mts` because this change explicitly
  asserts Qwen/local attachment-path parity, even though it does not modify
  local-model internals.

## Rollout

This is backward compatible with existing tasks. Old tasks with filename-only
attachment text cannot be repaired automatically because the bytes may not exist
on disk. New tasks and future retry/reply continuations will carry stable
`~/.hivematrix/uploads` paths.
