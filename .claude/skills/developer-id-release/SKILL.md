---
name: developer-id-release
description: >-
  Build/sign/notarize/publish the HiveMatrix macOS app (Developer ID, public
  website DMG + external updater — NOT the Mac App Store). Use for any release,
  build, notarization, provisioning-profile, or code-signing task. Encodes the
  exact machine facts (profile names/IDs/locations, keychain, notary profile) so
  agents stop rediscovering them.
argument-hint: --verify-only | --build-only | --release [--marketing-version X.Y.Z] [--skip-notarize] [--note "text"]
options: |
  --verify-only              (mode) Prereqs + gates only; no build, no publish
  --build-only               (mode) Local signed build (notarized); no publish/commit
  --release                  (mode) Full: bump → build → notarize → staple → publish core feed → verify
  --marketing-version=X.Y.Z  Set the marketing version (else auto patch-bump on --release)
  --skip-notarize            Local dry run only; refused with --release
  --note=text                Release note (changelog + commit message)
---

# HiveMatrix Developer ID Release

**One canonical command — do not hand-roll the pipeline:**
```bash
./scripts/developer-id-release.sh --release            # bump→build→sign→notarize→staple→publish→verify — BETA channel (default)
./scripts/developer-id-release.sh --release --stable   # same, published to STABLE (website download + everyone)
./scripts/developer-id-release.sh --verify-only        # prereqs + gates, no build
./scripts/developer-id-release.sh --build-only --skip-notarize   # local dry build
./scripts/developer-id-release.sh --release --marketing-version 0.2.0 --note "…"
```
**Publishing defaults to BETA.** `--release` alone ships only to installs that
opted in via Settings → Updates → Channel; the website download and every other
install stay on stable. Pass `--stable` to promote. Channel model: DECISIONS.md
Q25 and `docs/RELEASE.md` § Update channels.
Exit codes: `0` ok · `1` prereq/step failure · `2` bad usage. Full reference:
`docs/agent-commands/developer-id-release.md`. Design + migration rationale:
`docs/superpowers/specs/2026-07-05-developer-id-release-design.md`.

Distribution is **Developer ID + Apple notarization** for the public website DMG /
external auto-update feed. **Never** switch this to Mac App Store signing.

## Fixed identity facts (do not guess these)

| Fact | Value |
|------|-------|
| Product | `HiveMatrix` |
| Bundle ID (macOS app) | `com.irvcassio.hivematrix.core` |
| Team ID | `8B3CHTY93V` |
| Signing identity | `Developer ID Application: Irven Cassio (8B3CHTY93V)` |
| Provisioning profile name | `HiveMatrix Core` (type: Developer ID Application, platform OSX) |
| Profile app-id | `8B3CHTY93V.com.irvcassio.hivematrix.core` |
| Notary keychain profile | `hivematrix` |
| Updater feed asset (stable) | `hivematrix-core.json` at `releases/latest/download/` (legacy `latest.json` is frozen) |
| Updater feed asset (beta) | `hivematrix-core-beta.json` on the permanent `beta-channel` pointer release |
| Apple ID (notary) | `cassio.irv@gmail.com` |

## Gotchas that WILL trip you (learned the hard way)

1. **Provisioning profiles live in Xcode's dir, not just the legacy one.**
   Xcode 16+ installs them to
   `~/Library/Developer/Xcode/UserData/Provisioning Profiles/`.
   The legacy `~/Library/MobileDevice/Provisioning Profiles/` may only hold old
   iOS profiles. **Scan BOTH.** `scripts/verify-provisioning-profile.mjs` does.

2. **macOS Developer ID profiles store the bundle app-id under
   `com.apple.application-identifier`**, NOT the iOS `application-identifier` key.
   Parse either. (This is why a valid profile can look "missing/empty".)

3. **Keychain items are in the LOGIN keychain:**
   `~/Library/Keychains/login.keychain-db`. The Developer ID cert and the
   `hivematrix` notarytool profile both live there. Pass
   `--keychain "$HOME/Library/Keychains/login.keychain-db"` to `notarytool`.

4. **Don't confuse the sibling Apple profiles.** The team also has:
   `HiveMatrix App` / iOS Team Provisioning (`com.irvcassio.hivematrix.app`, iOS),
   `HiveMatrix Watch Development`, `Browser Lane Developer ID`,
   `HiveMatrix Developer Edition`, `BrainPower App Store`. The macOS release uses
   **only** `HiveMatrix Core`.

## Verify the profile standalone
```bash
node scripts/verify-provisioning-profile.mjs   # exit 0 = HiveMatrix Core present + valid
```

## Notary credentials (resolved + printed, never the secret)
Order: `NOTARYTOOL_KEYCHAIN_PROFILE` → default keychain profile `hivematrix` →
`APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` (+ `APPLE_TEAM_ID`, default `8B3CHTY93V`).
Set up once with `bash scripts/setup-notary.sh`. Resolver: `scripts/notary-credentials.sh`.

## Updater signing key (auto-update artifacts)
`~/.hivematrix/tauri-updater.key` (+ `.password`). Required for `--release`
(loaded automatically by the command). If lost, installed apps can never verify
another update — treat as permanent.

## Version source of truth
`src-tauri/tauri.conf.json.version` (marketing), kept in lockstep with
`package.json` and `src/lib/version.ts` `VERSION`; `BUILD_NUMBER` is monotonic and
auto-incremented on release. Helper: `scripts/release-version.mjs`. Never reuse a
released version+build.

## Bundle-ID cutover (why the feed is separate)
Identity moved `com.cassio.hivematrix` → `com.irvcassio.hivematrix.core`. macOS
treats the new ID as a NEW app, so TCC grants (mic/Automation/Full Disk
Access/Accessibility) do NOT carry over. Rollout is a **clean reinstall cutover**:
the core identity polls its own `hivematrix-core.json`; the old `latest.json` is
frozen so existing installs are never silently migrated. Users reinstall the new
website DMG once.

## Outputs
`build/developer-id/<version>-b<build>/`: signed `.app.zip`, `.dmg`,
`.app.tar.gz`+`.sig`, `hivematrix-core.json`, `hivematrix-core-beta.json`, and `release-metadata.json`
(product, bundleId, version, build, gitCommit, signingIdentity, notarizationStatus,
feed URL, per-artifact sha256). `build/` is gitignored.

## No GUI steps
Everything is CLI. The only manual Apple-portal step is creating/downloading the
`HiveMatrix Core` Developer ID profile the first time; after it's installed to the
Xcode profiles dir, the command is fully non-interactive.
