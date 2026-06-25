# Decisions Browser Lane Copy Design

Date: 2026-06-25
Status: Approved by ongoing Browser Lane rename direction

## Problem

`DECISIONS.md` still teaches several old public browser names: `BrowserBee`, `WebBee`, `Bee lanes`, and `Bees view`. The file is historical, but it is also a working architecture memory for future agents. Leaving those terms there keeps pulling model routing and docs back toward the old naming.

## Decision

Update the browser-related decision prose to use Browser Lane, Desktop Lane, Message Lane, Mail Lane, Review Lane, and Memory Lane. Keep lower-case compatibility ids, route paths, config keys, and function names when they document stable contracts.

## Scope

- Update `DECISIONS.md` browser/web lane prose.
- Remove old public phrases `BrowserBee`, `WebBee`, `Weaver`, `Bee lanes`, and `Bees view`.
- Preserve lower-case compatibility details such as `/browserbee/health`, `browserbee.desktopFallback`, and `webbee_search/browserbee_run/desktopbee_action`.
- Avoid renaming TypeScript symbols or routes in this slice.

## Verification

Add a focused script test that checks `DECISIONS.md` uses Browser Lane wording and does not reintroduce the old public browser capability names.
