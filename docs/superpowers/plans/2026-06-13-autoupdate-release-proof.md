# Auto-Update Release Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [ ] Add failing tests for release proof rules.
  - File: `src/lib/updater/release-proof.test.ts`
  - Cover: all-green proof, version mismatch, existing tag on wrong commit, missing feed commit metadata, feed commit mismatch.

- [ ] Implement pure release proof evaluation.
  - File: `src/lib/updater/release-proof.ts`
  - Export `evaluateAutoUpdateProof`.

- [ ] Add an operator verification script.
  - File: `scripts/verify-autoupdate-release.mts`
  - Read package/Tauri/version metadata, current git HEAD, tag state, GitHub release/feed, and print pass/fail checks.

- [ ] Harden publish script.
  - File: `scripts/publish-release.sh`
  - Refuse to publish an already-tagged version from a different commit.
  - Stamp `latest.json` with `sourceCommit`, `buildNumber`, and `buildDate`.
  - Verify production `latest.json` after upload.

- [ ] Document the standing release directive.
  - File: `docs/directives/autoupdate-release-directive.md`
  - File: `docs/RELEASE.md`

- [ ] Verify.
  - Run focused tests.
  - Run `npm run typecheck`.
  - Run `npm test` with Node 22.22.3.
  - Run `node scripts/scope-wall.mjs`.
