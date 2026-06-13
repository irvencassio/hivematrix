# Frontier Usage Bars Design

## Problem

The console has progress-bar CSS and renders Claude subscription bars when the Claude usage API returns remaining windows. The panel does not surface Codex subscription windows, even though HiveMatrix already parses Codex rate-limit snapshots from local Codex session logs.

## Approaches

1. Leave the panel as Claude-only subscription bars plus spend rows.
   - Simple, but the user cannot see Codex progress even when the local data exists.
2. Add Codex subscription usage to `/usage` and render it as its own bar section.
   - Reuses the existing Codex parser and existing bar UI.
3. Poll a live Codex API.
   - Potentially fresher, but unnecessary and higher-risk than the local session snapshot.

## Selected Design

Use approach 2. `/usage` returns `codexSubscription` from the existing local Codex auth/session parser. The console renders Codex 5-hour and 7-day usage bars when windows exist, using `100 - utilization` as remaining capacity. If Codex is logged in but no usage snapshot is available, the panel keeps a visible Codex row that says usage is unavailable.

Claude remains separate: it renders bars only when Claude subscription usage is available, and otherwise shows the existing status message.

## Verification

- Unit test `/usage` aggregation includes Codex subscription data.
- Console script syntax test remains the guardrail for UI JS.
- Run repository verification gates before publishing the updater release.
