# Auto-Update Release Proof Design

## Context

HiveMatrix auto-update is version-driven. A commit on `main` is not visible to installed apps until a signed GitHub Release publishes a `latest.json` with a newer version. Re-uploading assets to an existing version is especially dangerous: the tarball may contain new code, but clients already on that version will not install it because the advertised version did not increase.

## Approach

Make the updater channel provable:

- `publish-release.sh` refuses to publish if `v<version>` already points at a different commit.
- `latest.json` includes the exact source commit and build metadata.
- A verification script checks version agreement, tag/release/feed alignment, and feed source commit.
- Release docs include a standing directive/checklist for “main code is not done until the update feed proves it.”

## Release Rule

Every code change intended for installed users must either:

1. Bump the version/build, build, publish, and verify the updater feed, or
2. Stay explicitly unreleased with that status visible in the release proof.

## Verification

- Unit tests for release-proof evaluation.
- `publish-release.sh` post-publish fetches production `latest.json` and checks `version` + `sourceCommit`.
- `npm test`, `npm run typecheck`, and `node scripts/scope-wall.mjs`.
