# About Version Metadata Refresh Design

## Problem

The Settings About panel can show `v?`, build `?`, and released `?` even when the installed daemon reports real version metadata. The update status can still say `up to date` because it is fetched independently from `/update/status`.

## Cause

The About panel reads `models.version` from the global `models` object. If the user opens About before `/models` has loaded, `renderAbout()` fills fallback question marks and nothing re-renders the About fields after `loadModels()` completes.

## Approach

Keep `/models` as the source of truth for the About version rows. After `loadModels()` updates the global `models` object, re-render About when the About panel is currently visible. This keeps the UI accurate without duplicating version fetches or changing release/update semantics.

## Verification

Add a console regression test proving `loadModels()` refreshes About metadata after assigning the fetched models payload.
