# Project Discovery Rescan Design

## Context

The project discovery endpoint can return repos that live under the user's Trash because the git scan walks `$HOME` broadly and other sources may also point at discarded folders. A separate install can also end up with an empty project selector and no obvious way to force a fresh scan from the main console.

## Goal

Keep discarded repos out of discovered projects and make project discovery recoverable from the visible project controls when the list is empty.

## Approaches

1. Filter only the git `find` command.
   This removes many Trash results, but Claude Code or VS Code recents can still reintroduce paths under `.Trash`.

2. Add a shared path eligibility helper and apply it at every discovery source boundary.
   This keeps the invariant close to project discovery and protects future sources.

3. Only clean the UI list after discovery.
   This hides noise in the console but still writes bad paths into cache and API responses.

## Decision

Use approach 2. A shared helper will reject the home Trash folder and other container paths before any discovered path enters the merged project set. The console will also expose a fresh scan action beside the header project selector and inside the empty project dropdown.

## Verification

- A discovery regression test creates a fake repo under `$HOME/.Trash` and proves it is excluded from a fresh scan.
- Console tests assert the visible project rescan controls exist and still call `loadProjects(true)`.
- Run the focused tests, then typecheck and the required verification gates.
