# HiveMatrix Release & Packaging

The DMG is a complete appliance: it bundles the daemon runtime (Node + native
addon), the DesktopBee helper, and a first-run wizard. A user installs the DMG,
runs setup once, and the app self-supervises (launchd) and self-updates.

## One-time setup
- Apple **Developer ID Application** cert in the login keychain (present: `8B3CHTY93V`).
- `notarytool` keychain profile named `hivematrix` (`bash scripts/setup-notary.sh`).
- Rust + `cargo-tauri`.

## Build a signed, notarized DMG
```bash
bash scripts/build-app.sh      # build:daemon -> cargo tauri build -> sign inner Mach-Os
                               # -> re-seal app -> notarize -> staple -> dist zip
bash scripts/build-dmg.sh 0.1.0   # drag-to-Applications DMG -> sign -> notarize -> staple
```
`build-app.sh` runs `npm run build:daemon` first so Tauri bundles `dist/daemon/`
as a resource, then signs the injected binaries (bundled **Node**,
`better_sqlite3.node`, nested **DesktopBeeHelper.app**) with our Developer ID +
hardened runtime + entitlements (`src-tauri/entitlements/`), then re-seals the
outer app so notarization accepts the whole bundle.

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

## Auto-update (Tauri updater + GitHub Releases) — release-time secret
Auto-update is wired (plugin + `plugins.updater` endpoints + a Rust background
check in `src-tauri/src/lib.rs`) but **disabled until you provide the signing
key**, because that key permanently anchors update continuity and must be owned
by the release maintainer, not generated ad hoc.

To enable:
1. `cargo tauri signer generate -w ~/.hivematrix/tauri-updater.key` (guard the
   private key; store it in CI secrets, never commit it).
2. Put the printed **public key** in `src-tauri/tauri.conf.json`
   `plugins.updater.pubkey` (replacing the placeholder).
3. Set `bundle.createUpdaterArtifacts: true`.
4. Build with `TAURI_SIGNING_PRIVATE_KEY` (+ `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`)
   in the environment.
5. Publish the `.app.tar.gz`, its `.sig`, and a `latest.json` to the GitHub
   Releases `latest` tag (the endpoint in `plugins.updater.endpoints`).

## First-run wizard (what the installed app sets up)
Served from the daemon console when required setup is incomplete; each step POSTs
to `/onboarding/*` (see `src/lib/onboarding/actions.ts`):
- **config** — write `~/.hivematrix/config.json` + daemon token
- **brain** — set the canonical `config.memory.brainRootDir` (the one store every
  harness reads); optional `~/brain` shortcut
- **local-model** — point at an OpenAI-compatible endpoint, or choose cloud-only
- **daemon** — install + load the launchd agent pointing at the bundled daemon
  (refuses unless the app is in `/Applications` — translocation guard)
- **frontier** — API keys or detected `claude`/`codex` CLI
- **desktopbee** — install the helper launchd agent + open the Accessibility /
  Screen Recording panes
