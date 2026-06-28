# One Command Autodeploy Design

## Problem

HiveMatrix already has a release lane in `scripts/release.mjs`, but the operator needs one repeatable command that makes the release path obvious: commit all changes to `main`, push, increment the version, build the signed/notarized app, publish the update feed, and identify where the notary/release logic lives.

The recent confusion was specifically around source-of-truth location. The command should print the exact files that own release/notary behavior before it runs the release lane. The user also asked for "Node-RED logic"; a source search shows no Node-RED code in this repo, so the script should state that and point to the notary/release files if that was the intended target.

## Approach

Add one shell entrypoint:

- `scripts/autodeploy-main.sh`

Add one npm command:

- `npm run autodeploy`

The shell script will:

1. Run from the repository root.
2. Print the release/notary source files:
   - `scripts/release.mjs`
   - `scripts/build-app.sh`
   - `scripts/build-dmg.sh`
   - `scripts/setup-notary.sh`
   - `scripts/notary-identity.test.mjs`
3. Search HiveMatrix source/operational scripts for Node-RED references, excluding this wrapper/test, and report either matches or "none found."
4. Require the current branch to be `main`.
5. Fetch `origin/main`.
6. Compute the next patch version from `package.json`, unless an explicit `x.y.z` version is provided.
7. Call `node scripts/release.mjs <version> <note>`.

`scripts/release.mjs` remains the single owner of the actual release workflow: gates, version file rewrites, `git add -A`, commit, push, signed/notarized builds, GitHub release/feed publishing, and live update-feed verification.

## Acceptance

- `npm run autodeploy` is listed in `package.json`.
- README command list includes the repeatable command.
- The script increments the patch version automatically by passing the next version into `scripts/release.mjs`.
- The script prints the release/notary source-of-truth files.
- The script prints whether Node-RED logic exists in HiveMatrix.
- Focused source tests cover the wrapper behavior without running the release.
- Gates pass: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.
