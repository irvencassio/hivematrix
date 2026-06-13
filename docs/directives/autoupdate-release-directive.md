# Standing Directive: Auto-Update Release Proof

## Goal

Whenever HiveMatrix code is committed for installed users, make the change visible through the signed auto-update channel or explicitly mark it unreleased.

## Trigger

Run after any merge/push to `main` that changes app, daemon, desktop helper, iOS pairing contracts, release scripts, updater behavior, or user-visible docs that ship with the app.

## Criteria

- Version fields agree:
  - `package.json`
  - `src-tauri/tauri.conf.json`
  - `src/lib/version.ts`
- The version/build has been bumped for user-visible code changes.
- `bash scripts/build-app.sh` was run from a clean worktree at the intended commit.
- `bash scripts/publish-release.sh` completed without guardrail failures.
- `npm run release:verify` passes against the live GitHub Releases feed.
- A real installed app reports the new version/build after update or manual install.

## Failure Response

If `npm run release:verify` fails, do not call the work released. Either cut the release or tell the operator exactly which commit/version is still unreleased.
