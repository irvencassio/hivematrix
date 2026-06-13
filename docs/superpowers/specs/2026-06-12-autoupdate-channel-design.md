# HiveMatrix Autoupdate Channel Design

## Context

HiveMatrix uses the Tauri updater in the desktop shell. On startup,
`src-tauri/src/lib.rs` calls the updater plugin, checks the configured endpoint,
downloads the platform artifact, verifies the minisign signature against the
public key in `src-tauri/tauri.conf.json`, installs, and restarts.

The release artifacts for `v0.1.1` exist on GitHub Releases:

- `latest.json`
- `HiveMatrix.app.tar.gz`
- `HiveMatrix.app.tar.gz.sig`
- `HiveMatrix_0.1.1_aarch64.dmg`

The repository is currently private, so the configured endpoint
`https://github.com/irvencassio/hivematrix/releases/latest/download/latest.json`
returns `404` without authentication. The shipped Tauri updater does not attach
GitHub authentication headers.

## Goal

Make the production autoupdate path work for installed HiveMatrix apps by
ensuring the baked updater endpoint is reachable, signed artifacts are valid,
and release builds are signed, notarized, and stapled.

## Approaches

### Approach A: Public source repository

Make `irvencassio/hivematrix` public. This preserves the already-baked endpoint
for `0.1.1` and makes the existing release feed and tarball URLs anonymously
reachable.

Pros:

- Existing `0.1.1` installs can update without a manual bootstrap.
- No endpoint migration is needed.
- `scripts/publish-release.sh` remains aligned with `tauri.conf.json`.

Cons:

- The source repository becomes public.
- This is a repository visibility decision, not a code-only change.

### Approach B: Public binary/update-channel repository

Create or use a separate public repository for updater assets, then change
`src-tauri/tauri.conf.json` and `scripts/publish-release.sh` to point there.

Pros:

- Keeps the source repository private.
- Gives the updater an anonymous public feed.

Cons:

- Existing `0.1.1` installs still point at the private source repo and cannot
  discover the new channel. Users need one manual bootstrap install.
- Requires maintaining a second release surface.

### Approach C: Authenticated private updater

Teach the app updater to attach a token and fetch private GitHub release assets.

Pros:

- Keeps all assets private.

Cons:

- Requires securely provisioning a token to every installed app.
- Increases credential leakage risk.
- Does not help clean first-run distribution without a token bootstrap.

## Decision

For existing `0.1.1` installs to auto-update with no manual reinstall, Approach A
is the only compatible path because the endpoint is already baked into the app.
If the source repo must remain private, Approach B is the safer product path, but
it requires a one-time manual install of the first build that points at the
public binary channel.

## Acceptance Criteria

- The configured updater endpoint returns `200` anonymously.
- `latest.json` contains a `darwin-aarch64` platform entry.
- The tarball URL inside `latest.json` returns `200` anonymously.
- The updater public key in `tauri.conf.json` matches the key used to sign the
  tarball.
- The final `.app` and `.dmg` pass signing, notarization, stapling, and
  Gatekeeper checks.
- `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs` pass.
