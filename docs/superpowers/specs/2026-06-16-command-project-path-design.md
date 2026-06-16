# Command Project Path Design

## Problem

Local slash commands launched from the console currently create tasks with
`projectPath: process.cwd()`. In the installed macOS app, the daemon can run with
`cwd` set to `/`, so a command task tries to prepare `/.claude` and fails before
Claude Code starts.

## Requirements

- Command tasks must use the operator-selected project path from the console.
- Server-side code must not hard-code `/Users/irvcassio` or any other username.
- Accepted command project paths must resolve from the current user's `$HOME`.
- `~` and `$HOME` input forms are accepted and expanded on the server.
- `/`, empty strings, and paths outside `$HOME` are rejected with a clear 400
  response instead of creating a broken task.
- Existing local command discovery under the active Claude profile remains
  unchanged.

## Design

The console already maintains the selected project path in the New Task form's
`#t_path` input. The command launcher will send that value as `projectPath` when
posting to `/commands/run`.

The daemon will add a small path-normalization helper beside the command route.
It expands `~` and `$HOME` using `os.homedir()`, resolves the result, rejects
root `/`, and requires the resolved path to be either `$HOME` or a descendant of
`$HOME`. `/commands/run` will use the normalized value when creating the task.

## Testing

Add unit coverage for path normalization:

- `~/hivematrix` resolves under the test `$HOME`.
- `$HOME/hivematrix` resolves under the test `$HOME`.
- `/` is rejected.
- `/tmp/...` outside `$HOME` is rejected.

Add a console HTML assertion that command launch payloads include `projectPath`,
so future UI changes do not regress the selected-project handoff.
