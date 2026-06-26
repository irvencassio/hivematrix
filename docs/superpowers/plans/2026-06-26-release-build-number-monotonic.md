# Release Build Number Monotonicity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-26-release-build-number-monotonic-design.md`

## Task 1 — RED: Release script source tests

- [x] Add `scripts/release-build-number.test.mjs`.
- [x] Assert `scripts/release.mjs` replaces `BUILD_NUMBER` with `Number(...) + 1`.
- [x] Assert `scripts/release.mjs` replaces `BUILD_DATE` with today's release date string.
- [x] Run the focused test and confirm it fails before production code changes.

## Task 2 — RED: Release proof build matching

- [x] Extend `src/lib/updater/release-proof.test.ts` with a failing case where
  `feedBuildNumber` differs from `buildNumber`.
- [x] Run the focused updater proof test and confirm failure.

## Task 3 — GREEN: Release script bump

- [x] Update `scripts/release.mjs` to parse current `BUILD_NUMBER`, increment it,
  and rewrite `BUILD_DATE`.
- [x] Fail fast with a clear error if either constant cannot be found.

## Task 4 — GREEN: Release proof

- [x] Add `feedBuildNumber` to `AutoUpdateProofInput`.
- [x] Fetch `buildNumber` from live `latest.json` in
  `scripts/verify-autoupdate-release.mts`.
- [x] Add a `feed-build-number` check.

## Task 5 — Verify

- [x] Run focused tests.
- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [ ] Commit and push to `main`.
