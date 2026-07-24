# Command: `developer-id-release.sh`

The **one canonical command** to build/ship the HiveMatrix macOS app. Any worker
model (Claude, Codex) can call it. It is deterministic and
non-interactive: **no GUI steps, no Finder/AppleScript, no clicking.**

Distribution: **Developer ID** (public website DMG + external auto-update feed) with
Apple **notarization**. This is NOT the Mac App Store.

- Product: `HiveMatrix`
- Bundle ID: `com.irvcassio.hivematrix.core`
- Team ID: `8B3CHTY93V`
- Signing identity: `Developer ID Application: Irven Cassio (8B3CHTY93V)`
- Update feed asset: `hivematrix-core.json` (stable) · `hivematrix-core-beta.json` (beta)

## Canonical command

```bash
./scripts/developer-id-release.sh --release            # publishes to BETA (the default)
./scripts/developer-id-release.sh --release --stable   # publishes to STABLE (everyone)
```

## Exit codes (check these, don't parse prose)

| Code | Meaning |
|------|---------|
| `0`  | success |
| `1`  | a prerequisite or build/publish step failed |
| `2`  | bad usage / bad arguments |

## Modes (exactly one required)

| Flag | What it does | Notarizes? | Publishes? | Bumps version? |
|------|--------------|:----------:|:----------:|:--------------:|
| `--verify-only` | prereqs + `typecheck`/`test`/`scope-wall` only | no | no | no |
| `--build-only` (alias `--archive-only`) | build a signed `.app` + `.dmg` locally | yes¹ | no | no² |
| `--release` | full pipeline: bump → build → notarize → staple → publish feed → verify | yes | yes | yes |

¹ unless `--skip-notarize` is passed. ² unless `--marketing-version` is passed.

## Option flags

| Flag | Meaning |
|------|---------|
| `--beta` | publish to the **beta** channel. **This is the default** — beta clients see it, stable clients do not, and the website download is untouched. |
| `--stable` | publish to the **stable** channel: the release is marked *Latest* (so the website download resolves to it) and BOTH feeds are advanced. |
| `--marketing-version X.Y.Z` | set the marketing version explicitly. On `--release`, if omitted, the patch is auto-incremented. |
| `--skip-notarize` | **local dry run only.** Builds + signs but does NOT notarize/staple. **Refused (exit 2) with `--release`.** |
| `--note "text"` | release note (goes into the changelog + commit message). |
| `-h`, `--help` | print usage, exit 0. |

## Inputs (environment / machine state)

- **Signing:** the `Developer ID Application: Irven Cassio (8B3CHTY93V)` certificate must be in the keychain.
- **Notary credentials** (resolved in this order, mechanism printed, secrets never printed):
  1. `NOTARYTOOL_KEYCHAIN_PROFILE` — name of a saved `notarytool` keychain profile.
  2. Default keychain profile `hivematrix` (set up once via `scripts/setup-notary.sh`).
  3. `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` (+ `APPLE_TEAM_ID`, default `8B3CHTY93V`).
- **Provisioning profile (`--release` only, HARD gate):** the `HiveMatrix Core` Developer ID
  profile for `com.irvcassio.hivematrix.core` must be installed. Profiles live in
  **either** `~/Library/Developer/Xcode/UserData/Provisioning Profiles/` (Xcode 16+)
  **or** `~/Library/MobileDevice/Provisioning Profiles/` (legacy) — the verifier scans both.
  Note: macOS Developer ID profiles carry the bundle id under `com.apple.application-identifier`.
  Check it standalone with:
  ```bash
  node scripts/verify-provisioning-profile.mjs   # exit 0 = present+valid, 1 = missing/mismatched
  ```
- **Git (`--release` only):** on `main`, clean working tree, and the target `vX.Y.Z` tag must not already exist.
- **Updater signing key:** `~/.hivematrix/tauri-updater.key` (+ `.password`) for the auto-update signature (used by `build-app.sh`).

## Outputs

- Build artifacts: `src-tauri/target/release/bundle/…` (`.app`, `.dmg`, `.app.tar.gz` + `.sig`, `hivematrix-core.json`).
- A self-contained drop + metadata under **`build/developer-id/<version>-b<build>/`**:
  - copies of every distributable artifact,
  - `release-metadata.json` — product, bundleId, version, buildNumber, gitCommit,
    signingIdentity, notarizationStatus, feed URL, and each artifact's `sha256`.
- On `--release --beta` (default): a **prerelease** `vX.Y.Z` (never marked *Latest*), and the `beta-channel` pointer release's `hivematrix-core-beta.json` advanced. The stable feed is not touched.
- On `--release --stable`: a `vX.Y.Z` release marked *Latest* carrying `hivematrix-core.json`, **and** the beta pointer advanced too (so beta clients are not stranded below stable).
- Either way, a passing live-feed proof for the channel that was published.

## Examples

Verify prerequisites + gates only (no build):
```bash
./scripts/developer-id-release.sh --verify-only        # exit 0 if ready to release
```

Local dry build, unsigned by Apple (fastest; do NOT distribute):
```bash
./scripts/developer-id-release.sh --build-only --skip-notarize
```

Local build WITH notarization, but do not publish:
```bash
./scripts/developer-id-release.sh --build-only
```

Full signed + notarized release to the beta channel (the default — opted-in
installs only, website download unchanged):
```bash
./scripts/developer-id-release.sh --release
```

Promote to everyone (website download + every install that has not opted in):
```bash
./scripts/developer-id-release.sh --release --stable
```

Full release at an explicit marketing version, with a note:
```bash
./scripts/developer-id-release.sh --release --marketing-version 0.2.0 --note "Rebrand to HiveMatrix Core"
```

## Bundle-ID cutover note (important)

The identifier moved from `com.cassio.hivematrix` → `com.irvcassio.hivematrix.core`.
macOS treats the new identifier as a **new app**, so old installs' permissions
(mic, Automation, Full Disk Access, Accessibility) do NOT carry over. The rollout
is a **clean reinstall cutover**: the new identity ships on its own feed asset
(`hivematrix-core.json`); the legacy `latest.json` is frozen so old installs are
never silently migrated. Existing users install the new website DMG once. See
`docs/superpowers/specs/2026-07-05-developer-id-release-design.md`.

## If it stops with a clear error

- `provisioning-profile gate failed` → the `HiveMatrix Core` Developer ID profile
  is not installed. Create/download it in the Apple Developer portal for
  `com.irvcassio.hivematrix.core` (macOS, Developer ID Application), double-click to
  install, retry. This is a manual Apple-portal step (the only one).
- `no notary credentials` → set one of the credential mechanisms above.
- `signing identity not found` → the Developer ID Application cert is missing from the keychain.
- `tag vX.Y.Z already exists` → pass a new `--marketing-version`.
