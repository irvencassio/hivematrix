# Browser Lane Code Prose Design

Date: 2026-06-25
Status: Approved by ongoing Browser Lane rename direction

## Problem

Some source comments and test descriptions still use old browser/web capability names. These are not wire contracts; they are explanatory prose that future agents will read while making routing changes.

## Decision

Update browser-related comments and test labels to say Browser Lane. Preserve lower-case compatibility ids, exported `BrowserBee*` type/function names, routes, and config keys.

## Scope

- Update browser/web prose in `src/lib/routing/router.ts`.
- Update browser/web assertion messaging in `src/daemon/connectivity-integration.test.ts`.
- Update the Desktop Lane action-contract comment in `src/lib/desktopbee/actions.ts`.
- Update the lane status test description in `src/lib/lanes/status.test.ts`.
- Avoid renaming TypeScript symbols, compatibility ids, routes, config keys, or fixture `kind` values.

## Verification

Add a focused script test that checks those prose surfaces use Browser Lane naming and no longer contain old browser/web public phrases.
