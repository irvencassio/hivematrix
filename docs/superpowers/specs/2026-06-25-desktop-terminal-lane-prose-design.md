# Desktop And Terminal Lane Prose Design

## Context

HiveMatrix still keeps compatibility names for the desktop helper and terminal-session APIs, including `DesktopBee*`, `TermBee*`, `DesktopBeeHelper.app`, `desktopbee-token`, and `__TERMBEE_DONE_*`. Those names are part of contracts, filenames, or migration-safe internals. Source and docs prose should nevertheless describe the capabilities as Desktop Lane and Terminal Lane.

## Approved Direction

Continue the lane-name migration for descriptive prose only:

- `Desktop Lane` for macOS helper actions, approvals, vision, workflows, helper auth, and security-review language.
- `Terminal Lane` for long-lived local shell sessions and terminal-session helpers.

Compatibility symbols, file paths, route names, token filenames, marker strings, and helper app bundle names remain unchanged.

## Scope

Update prose/comments in:

- `src/lib/desktopbee/actions.ts`
- `src/lib/desktopbee/client.ts`
- `src/lib/desktopbee/workflow.ts`
- `src/lib/desktopbee/vision.ts`
- `src/lib/desktopbee/contracts.ts`
- `src/lib/termbee/session.ts`
- `src/lib/termbee/contracts.ts`
- `src/lib/auth/token.ts`
- `docs/SECURITY-REVIEW.md`

Add a focused regression test that asserts lane prose is present and the old descriptive snippets are absent.

## Non-Goals

- Do not rename `DesktopBee*` or `TermBee*` exported symbols.
- Do not rename `DesktopBeeHelper.app`, `/desktopbee/*`, `desktopbee-token`, `desktopbeeRequest`, or `__TERMBEE_DONE_*`.
- Do not change runtime behavior.

## Verification

- Focused Desktop/Terminal lane prose test.
- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`
