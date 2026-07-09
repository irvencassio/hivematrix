# Developer ID Release — Design

> ⚠️ **SUPERSEDED 2026-07-06 — DeepSeek/ds4 removed; the local stack is Qwen-only.**
> Retained as a historical record. See
> docs/superpowers/plans/2026-07-06-qwen-only-local-presets.md


> Superpowers brainstorming artifact. Decisions in this doc were approved by the operator on 2026-07-05 (see "Decisions locked").

## Problem

HiveMatrix ships a public-website DMG + an external auto-update feed (NOT the Mac App Store). The release path today is `scripts/release.mjs` plus a set of bash sub-scripts (`build-app.sh`, `build-dmg.sh`, `sign-bundled-machos.sh`, `publish-release.sh`, `verify-autoupdate-release.mts`). Two gaps:

1. The production macOS bundle identifier is the old personal `com.cassio.hivematrix`. Apple is now organised around the `HiveMatrix Core` Developer ID App ID `com.irvcassio.hivematrix.core` (team `8B3CHTY93V`).
2. There is no single canonical, deterministic, non-interactive release command that any HiveMatrix worker model (Claude, Codex, DeepSeek/local) can invoke with explicit inputs/outputs/exit codes. `release.mjs` is Node, has hidden ordering, and doesn't emit machine-readable release metadata.

## Goals

- Change the production macOS identifier to `com.irvcassio.hivematrix.core`, keeping **Developer ID Application** signing + hardened runtime + entitlements (NOT App Store).
- One deterministic command `./scripts/developer-id-release.sh` with flags: `--verify-only`, `--build-only`/`--archive-only`, `--release`, `--marketing-version X.Y.Z`, `--skip-notarize` (dry-run only).
- Auto-increment build number; keep `package.json` / `tauri.conf.json` / `src/lib/version.ts` versions in sync; never reuse a released version+build.
- Verify the `HiveMatrix Core` Developer ID provisioning profile as a hard prerequisite for a real release.
- Machine-readable outputs + logs under `build/developer-id/`, including a release-metadata JSON with sha256 hashes.
- Cross-agent documentation with explicit exit codes and no GUI steps.

## Non-goals

- No Mac App Store / MAS signing. Developer ID + Apple notarization only.
- No change to the daemon launchd label (`com.hivematrix.daemon`), the `hivematrix://` deep-link scheme, or the `~/.hivematrix` data dir — all identity-independent (verified: `com.cassio.hivematrix` appears in exactly one functional location, `src-tauri/tauri.conf.json`).

## Decisions locked (operator, 2026-07-05)

1. **Migration = clean reinstall cutover.** Existing `com.cassio.hivematrix` installs must NOT silently auto-jump to the new bundle ID (that would reset every TCC grant). The old feed is frozen; the new identity ships as a fresh website DMG. Existing users reinstall once.
2. **`--release` publishes the full GitHub feed** (build → sign → notarize → staple → updater artifacts → publish → verify).
3. **`developer-id-release.sh` replaces `release.mjs` entirely.** `release.mjs` is removed; its testable logic (version/build bump, notary preflight) moves into tested helpers; its callers (`autodeploy-main.sh`, tests) are repointed.
4. **Provisioning-profile verification is a HARD gate** for `--release` (fatal if the `HiveMatrix Core` profile is absent/mismatched).

## Migration impact analysis (requirement #1)

Changing `CFBundleIdentifier` from `com.cassio.hivematrix` → `com.irvcassio.hivematrix.core`:

| Concern | Effect |
|---|---|
| macOS TCC permissions (mic, Automation/AppleEvents, Full Disk Access, Accessibility) | **Lost.** TCC is keyed by bundle ID + signing identity. The new ID is a *new app* to macOS; every grant must be re-approved. HiveMatrix depends on all of these (voice, Mail/Message lanes, DesktopBee). |
| Tauri in-place auto-update | Mechanically replaces the `.app` at its path; the updater does not enforce identifier equality. So a shared feed WOULD swap old installs to the new ID in place — exactly the silent TCC reset we must avoid. |
| launchd daemon (`com.hivematrix.daemon`) | Unaffected (label is not derived from the app bundle ID). |
| `hivematrix://` deep link, `~/.hivematrix` data/db | Unaffected. |
| Keychain items scoped to old ID / access groups | May become inaccessible under the new ID; re-auth may be needed. |

**Conclusion: auto-update cannot seamlessly migrate existing installs across bundle IDs without a one-time permission reset.** Therefore we do a clean cutover (locked decision #1). Concretely:

- **Freeze the old feed.** The cutover release does NOT publish a newer `latest.json` (the asset old installs poll). Old installs see no update and stay put; we tell them (release notes + website) to reinstall from the new DMG once.
- **New identity gets its own feed manifest.** The new app's updater endpoint points at a distinct asset (`latest.json` is reserved/frozen for the old ID; the core identity polls `hivematrix-core.json`). From the cutover release onward, that is THE feed and future core→core updates auto-apply normally.
- New website DMG is the primary install for everyone during cutover.

## Chosen architecture

```
./scripts/developer-id-release.sh   (bash orchestrator — canonical, non-interactive)
   ├─ arg parse + mode                       (in-script)
   ├─ prereq gate (fail-fast, prints credential mechanism, no secrets)
   │     ├─ scripts/verify-provisioning-profile.mjs   (NEW, TDD parser + CLI)
   │     └─ notary profile / signing identity checks
   ├─ version/build bump                      → scripts/release-version.mjs (NEW, TDD pure helpers)
   ├─ gates: npm run typecheck | npm test | node scripts/scope-wall.mjs
   ├─ build daemon runtime                    → npm run build:daemon / verify:daemon-runtime
   ├─ build+sign app + dmg                    → scripts/build-app.sh, scripts/build-dmg.sh (reused)
   ├─ notarize + staple + gatekeeper          → (inside build-app.sh/build-dmg.sh)
   ├─ updater artifacts                        → (inside build-app.sh)
   ├─ publish (only --release)                → scripts/publish-release.sh (reused, core-feed aware)
   ├─ verify release/update proof             → scripts/verify-autoupdate-release.mts (reused)
   └─ write build/developer-id/<version>+<build>/release-metadata.json + logs + sha256
```

Why bash orchestrator + small Node helpers: the requested interface is a shell command (`./scripts/... --release`) that any agent can call; ordering/gates are naturally shell. But JSON/version mutation and profile-plist parsing are error-prone in bash, so those become **pure, unit-tested Node helpers** (TDD per AGENTS.md). Existing signing/notary bash is already correct and battle-tested — reused, not rewritten.

### Flags / modes

| Flag | Behaviour | Notarize | Publish |
|---|---|---|---|
| `--verify-only` | prereqs + gates + profile/notary/signing checks; no build | no | no |
| `--build-only` / `--archive-only` | verify + version bump (in-place, uncommitted) + build signed app + dmg + updater artifacts + metadata | yes (unless `--skip-notarize`) | no |
| `--release` | full: verify (hard profile gate) → bump+commit+push → build → notarize → staple → publish core feed → verify proof | yes | yes |
| `--marketing-version X.Y.Z` | set marketing version deterministically (else auto patch-bump on `--release`) | — | — |
| `--skip-notarize` | dry-run only; refused together with `--release` | no | no |

### Version source of truth

`src-tauri/tauri.conf.json.version` is the marketing version of record; `package.json.version` and `src/lib/version.ts` (`VERSION`) are kept in lockstep (enforced by `publish-release.sh` + `verify-autoupdate-release.mts`, which already fail on disagreement). `BUILD_NUMBER` in `src/lib/version.ts` is the monotonic build counter, auto-incremented before a real release. `--verify-only` and `--build-only` do NOT bump/commit (repeatable dry runs); only `--release` bumps + commits + tags via publish.

### Credential mechanism (requirement #5)

Resolution order, printed explicitly (never the secret value):
1. `NOTARYTOOL_KEYCHAIN_PROFILE` env → `xcrun notarytool ... --keychain-profile "$NOTARYTOOL_KEYCHAIN_PROFILE"`.
2. Else default keychain profile `hivematrix` (existing, present on this machine).
3. Else `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` (default `8B3CHTY93V`) env → `--apple-id/--password/--team-id`.
4. Else: fail fast with the exact missing-setup message.
The script prints e.g. `notary credential: keychain-profile "hivematrix"` — mechanism only.

### Outputs (requirement #8)

`build/developer-id/<version>-b<build>/`:
- `HiveMatrix.app.zip` (stapled), `HiveMatrix-<version>.dmg` (stapled), `HiveMatrix.app.tar.gz`(+`.sig`), `hivematrix-core.json` (feed), `notarize-*.log`, `release-metadata.json`.
- `release-metadata.json`: productName, bundleId, version, buildNumber, gitCommit, signingIdentity, notarizationStatus, artifacts[] with path+sha256, feed URL, timestamp.

## Alternatives considered

- **Rewrite the whole pipeline in one bash script.** Rejected — the notary/sign bash is subtle and correct; re-deriving it risks the "unsigned nested Mach-O / AppleDouble tar" bugs already solved. Reuse.
- **Keep `release.mjs`, wrap it.** Rejected by operator (decision #3) in favour of a single canonical command.
- **Shared feed, in-place auto-migrate.** Rejected by operator (decision #1) — silent TCC reset.

## Risks

- **Provisioning-profile location:** the `HiveMatrix Core` Developer ID profile IS installed, but in Xcode's dir (`~/Library/Developer/Xcode/UserData/Provisioning Profiles/`), not the legacy `~/Library/MobileDevice/…`. The verifier must scan both, and must read the bundle id from `com.apple.application-identifier` (macOS) as well as `application-identifier` (iOS) — otherwise a valid profile reads as "missing". (This bit us once; now covered by tests.)
- Removing `release.mjs` touches 3 tests + `autodeploy-main.sh`; all repointed and re-run green before completion.
- The `.core` App ID has **In-App Purchase** capability in the portal, but the shipped app declares no IAP entitlement; Developer ID direct distribution needs no embedded profile to run. Profile verification is a release *governance* gate, not a runtime requirement — documented as such.
