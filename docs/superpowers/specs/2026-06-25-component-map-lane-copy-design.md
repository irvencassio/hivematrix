# Component Map Lane Copy Design

Date: 2026-06-25
Status: Approved by ongoing Browser Lane rename direction

## Problem

`COMPONENT-MAP.md` is the canonical architecture map, but it still presents active capabilities as `BrowserBee`, `WebBee`, `MessageBee`, and similar public names. That conflicts with the lane-name strategy already applied to the console, operator docs, runtime copy, and model-facing prompts.

## Decision

Update the canonical map to use lane names as the public architecture vocabulary. Keep lower-case compatibility ids only where they describe stable routes, task sources, configuration keys, or tool contracts.

## Scope

- Replace public PascalCase Bee lane headings in `COMPONENT-MAP.md`.
- Collapse Browser/Web concepts into one Browser Lane entry.
- Preserve compatibility ids such as `browserbee`, `webbee`, `messagebee`, and `desktopbee` where they document stable wire contracts.
- Avoid renaming code symbols, file paths, package names, or routes in this slice.

## Verification

Add a focused script test that ensures `COMPONENT-MAP.md` uses lane names and does not reintroduce known PascalCase Bee public brands.
