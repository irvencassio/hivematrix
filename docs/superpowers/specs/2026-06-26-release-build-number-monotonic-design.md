# Release Build Number Monotonicity Design

> Date: 2026-06-26 · Status: approved by operator request · Topic: release-build-number-monotonic

## Problem

HiveMatrix releases advanced from `0.1.90` to `0.1.91` to `0.1.92`, but
`src/lib/version.ts` kept `BUILD_NUMBER = 636`. `scripts/release.mjs` updates
the semantic version but never increments `BUILD_NUMBER` or refreshes
`BUILD_DATE`. `release:verify` also only checks that a build number is present,
so a live feed with a stale build number still passes.

That makes the UI and release artifacts look stale even when auto-update is
functionally correct.

## Design

Update the release pipeline so a release always changes all user-visible build
metadata together:

- `package.json` / `package-lock.json`: semantic version.
- `src-tauri/tauri.conf.json`: semantic version.
- `src/lib/version.ts`:
  - `VERSION` becomes the release version.
  - `BUILD_NUMBER` increments by one from the current source value.
  - `BUILD_DATE` becomes today's UTC date (`YYYY-MM-DD`).

Update release proof so the live feed must match the source build number, not
just contain any positive build number.

## Non-Goals

- Do not publish another release in this slice.
- Do not change lane app version policy.
- Do not retroactively mutate the already-published `0.1.92` release feed.

## Acceptance Criteria

- A test fails if `scripts/release.mjs` stops rewriting `BUILD_NUMBER`.
- A test fails if `scripts/release.mjs` stops rewriting `BUILD_DATE`.
- Release proof fails when `feedBuildNumber` differs from source
  `BUILD_NUMBER`.
- `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs` pass.
