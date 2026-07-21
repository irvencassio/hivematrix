# HiveMatrix Release & Packaging

The DMG is a complete appliance: it bundles the daemon runtime (Node + native
addon), the Desktop Lane helper, and a first-run wizard. A user installs the DMG,
runs setup once, and the app self-supervises (launchd) and self-updates.

## Canonical command (use this)
One deterministic, agent-callable command does the whole pipeline
(bump → gates → build → sign → notarize → staple → publish → verify):
```bash
./scripts/developer-id-release.sh --release            # auto patch-bump + publish
./scripts/developer-id-release.sh --verify-only        # prereqs + gates, no build
./scripts/developer-id-release.sh --build-only --skip-notarize   # local dry build
```
See `docs/agent-commands/developer-id-release.md` for flags, inputs, outputs, and
exit codes. The sections below document the underlying sub-scripts it orchestrates.

Identity (Developer ID; NOT App Store): bundle id `com.irvcassio.hivematrix.core`,
team `8B3CHTY93V`. The core identity has its own update feed asset
`hivematrix-core.json`; the legacy `latest.json` (`com.cassio.hivematrix`) is
frozen so old installs are never auto-migrated across bundle IDs — see
`docs/superpowers/specs/2026-07-05-developer-id-release-design.md`.

## One-time setup
- Apple **Developer ID Application** cert in the login keychain (present: `8B3CHTY93V`).
- `notarytool` keychain profile named `hivematrix` (`bash scripts/setup-notary.sh`),
  or `NOTARYTOOL_KEYCHAIN_PROFILE` / `APPLE_ID`+`APPLE_APP_SPECIFIC_PASSWORD` env.
- The **`HiveMatrix Core`** Developer ID provisioning profile installed (release gate;
  verify with `node scripts/verify-provisioning-profile.mjs`).
- Rust + `cargo-tauri`.

## Build a signed, notarized DMG
```bash
bash scripts/build-app.sh      # build:daemon -> cargo tauri build -> sign inner Mach-Os
                               # -> re-seal app -> notarize -> staple -> dist zip
bash scripts/build-dmg.sh 0.1.0   # drag-to-Applications DMG -> sign -> notarize -> staple
```
`build-app.sh` runs `npm run build:daemon` first so Tauri bundles `dist/daemon/`
as a resource, then rebuilds the Desktop Lane helper compatibility bundle,
`DesktopBeeHelper.app`, from source (`bash desktopbee-helper/build-app.sh`) so
a stale helper binary can never ship silently, then signs the injected
binaries (bundled **Node**, `better_sqlite3.node`, and the freshly rebuilt
`DesktopBeeHelper.app`) with our Developer ID + hardened runtime +
entitlements (`src-tauri/entitlements/`), then re-seals the outer app so
notarization accepts the whole bundle.

Pinned Node version lives in `scripts/build-daemon.mjs` (`NODE_VERSION`) and must
match the ABI of `node_modules/better-sqlite3/build/Release/better_sqlite3.node`
(rebuild the addon under that Node if you bump it). Apple Silicon (arm64) only.

## Version bump
Bump all three together (they must agree — the daemon's boot gate compares them):
- `src-tauri/tauri.conf.json` → `version` (becomes Info.plist `CFBundleShortVersionString`)
- `package.json` → `version`
- `src/lib/version.ts` → `VERSION` (the dev/fallback constant)
At runtime the daemon reads the Info.plist version (`getBundledVersion`); on a
version bump it backs up the DB, runs migrations, self-checks, and records the
new `installedVersion` in `~/.hivematrix/state.json` — no re-onboarding.

## Auto-update (Tauri updater + GitHub Releases) — ENABLED (v0.1.1+)
Auto-update is live: the signing keypair exists, the public key is embedded in
`src-tauri/tauri.conf.json` (`plugins.updater.pubkey`), and
`bundle.createUpdaterArtifacts` is `true`. The private key **permanently anchors
update continuity** — if it (or its password) is lost, installed apps can never
verify another update and users must reinstall manually.

Key material (never commit; copy into CI/GitHub Actions secrets):
- `~/.hivematrix/tauri-updater.key` — private key (encrypted)
- `~/.hivematrix/tauri-updater.key.password` — its password
- `~/.hivematrix/tauri-updater.key.pub` — public key (same value as the
  `pubkey` in tauri.conf.json; safe to share)

Cutting a release:
1. Bump the three version fields (section above).
2. Build with the signing key in the environment:
   `export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.hivematrix/tauri-updater.key)"`
   `export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat ~/.hivematrix/tauri-updater.key.password)"`
   `bash scripts/build-app.sh`
   This emits `…/bundle/macos/HiveMatrix.app.tar.gz` + `.sig` alongside the
   .app/.dmg.
3. Publish: `bash scripts/publish-release.sh` — creates the `v<version>` GitHub
   release with the .dmg, the .app.tar.gz, its .sig, and a generated
   `latest.json` (the update manifest the endpoint in
   `plugins.updater.endpoints` resolves via `releases/latest/download/`).
   The publish script refuses to publish if `v<version>` already points at a
   different commit; installed apps only update when the version increases, so
   never re-use a version for new code.
4. Prove the live feed:
   `npm run release:verify`
   This verifies that `package.json`, `src-tauri/tauri.conf.json`,
   `src/lib/version.ts`, the `v<version>` tag, the GitHub release, and
   `latest.json` all point at the current commit.

Operational directive: keep
`docs/directives/autoupdate-release-directive.md` as the standing checklist for
agentic release work. A `main` commit is not considered delivered to installed
users until that directive's proof passes.

Bootstrap note: builds ≤0.1.0 shipped with a placeholder pubkey and cannot
consume this feed — install ≥0.1.1 manually once; every later release then
auto-updates (the daemon's boot gate handles migrations on relaunch).

## First-run wizard (what the installed app sets up)
Served from the daemon console when required setup is incomplete; each step POSTs
to `/onboarding/*` (see `src/lib/onboarding/actions.ts`):
- **config** — write `~/.hivematrix/config.json` + daemon token
- **brain** — set the canonical `config.memory.brainRootDir` (the one store every
  harness reads); optional `~/brain` shortcut
- **daemon** — install + load the launchd agent pointing at the bundled daemon
  (refuses unless the app is in `/Applications` — translocation guard)
- **frontier** (required) — detected `claude` CLI (or `codex`); keyless, no API
  keys. There is no local-model step: the local inference plane was removed in
  0.1.176
- **desktop** — install the Desktop Lane helper launchd agent + open the Accessibility /
  Screen Recording panes
