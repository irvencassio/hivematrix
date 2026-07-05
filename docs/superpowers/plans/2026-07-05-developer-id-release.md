# Developer ID Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-07-05-developer-id-release-design.md`. TDD where feasible (helper logic). Reuse existing signing/notary bash.

## 1. Bundle identity + feed

- [ ] Set `src-tauri/tauri.conf.json` `identifier` to `com.irvcassio.hivematrix.core`.
- [ ] Point the updater endpoint at the core feed asset `hivematrix-core.json` (leave the frozen old `latest.json` untouched). Keep `pubkey`, Developer ID `signingIdentity`, `hardenedRuntime: true`, `entitlements`.

## 2. TDD: version/build helper — `scripts/release-version.mjs`

- [ ] RED: `scripts/release-version.test.mjs` — `nextBuildNumber("682")===683`; `bumpPatch("0.1.138")==="0.1.139"`; `applyVersion({version, build, date})` returns rewritten contents for package.json/tauri.conf.json/version.ts that keep all three in sync; rejects a non-x.y.z marketing version; never lets build number stay equal.
- [ ] GREEN: implement pure functions (string transforms; no fs). A thin `writeVersionFiles()` wrapper does the fs writes. Export `readCurrentVersionState()`.
- [ ] Assert parity with what `release.mjs` did (BUILD_NUMBER+1, BUILD_DATE=today, changelog prepend preserved).

## 3. TDD: provisioning-profile verifier — `scripts/verify-provisioning-profile.mjs`

- [ ] RED: `scripts/verify-provisioning-profile.test.mjs` — pure `matchProfile(decoded, {name, bundleId, teamId})` returns ok for a Developer-ID `HiveMatrix Core` plist with `application-identifier === 8B3CHTY93V.com.irvcassio.hivematrix.core`; fails on wrong name / team / bundle ID / an iOS App Store profile.
- [ ] GREEN: implement `parseProfilePlist(xml)` (extract Name, TeamIdentifier, Entitlements.application-identifier, ProvisionsAllDevices/Platform → Developer ID heuristic) and `matchProfile()`. CLI: scan `~/Library/MobileDevice/Provisioning Profiles/*.{provisionprofile,mobileprovision}`, `security cms -D -i` each, print PASS/FAIL, exit 0/1. Never print secrets.

## 4. Orchestrator — `scripts/developer-id-release.sh`

- [ ] Arg parse: `--verify-only|--build-only|--archive-only|--release|--marketing-version X.Y.Z|--skip-notarize|-h`. Unknown flag → exit 2 with usage. `--release` + `--skip-notarize` → exit 2.
- [ ] Constants: product `HiveMatrix`, bundleId `com.irvcassio.hivematrix.core`, team `8B3CHTY93V`, identity `Developer ID Application: Irven Cassio (8B3CHTY93V)`, profile name `HiveMatrix Core`, out dir `build/developer-id`.
- [ ] `print_credential_mechanism()` — resolve NOTARYTOOL_KEYCHAIN_PROFILE → `hivematrix` → APPLE_ID+APPLE_APP_SPECIFIC_PASSWORD; print mechanism only; fail fast if none for notarizing modes.
- [ ] Prereq gate (all modes): on `main` for `--release`; git clean for `--release`; signing identity present (`security find-identity`); notary mechanism resolvable (unless `--skip-notarize`); **profile hard gate** via verifier for `--release`.
- [ ] `--verify-only`: prereqs + `npm run typecheck` + `npm test` + `node scripts/scope-wall.mjs` + `release:verify` (non-fatal if unpublished) → exit 0.
- [ ] `--build-only/--archive-only`: verify (no commit) → bump version files in place → `build-app.sh` (+`--skip-notarize` env honored) → `build-dmg.sh` → write metadata. No publish, no commit.
- [ ] `--release`: hard profile gate → bump+commit+push (via helper) → `build-app.sh` → `build-dmg.sh` → `publish-release.sh` (core feed) → `release:verify` → metadata.
- [ ] Metadata: `write-release-metadata.mjs` emits `release-metadata.json` (+ sha256 of each artifact) into `build/developer-id/<version>-b<build>/`, tee logs there.
- [ ] `chmod +x`.

## 5. Replace `release.mjs`

- [ ] Move notary-preflight + version-bump responsibilities into the orchestrator + `release-version.mjs`.
- [ ] `rm scripts/release.mjs`.
- [ ] Repoint `scripts/autodeploy-main.sh` to call `./scripts/developer-id-release.sh --release --marketing-version <v>` (keep the next-patch computation).
- [ ] Port `scripts/notary-identity.test.mjs` (preflight-before-bump assertion) → assert on `developer-id-release.sh`.
- [ ] Port `scripts/release-build-number.test.mjs` → assert `release-version.mjs` increments BUILD_NUMBER + refreshes BUILD_DATE.
- [ ] Update `scripts/autodeploy-main.test.mjs` to the new delegate.
- [ ] `package.json`: add `"release": "bash scripts/developer-id-release.sh"`; keep `release:verify`.

## 6. Cross-agent docs — `docs/agent-commands/developer-id-release.md`

- [ ] Canonical command, all examples (verify-only, dry build `--build-only --skip-notarize`, build w/o notarize, full release, marketing version), explicit inputs/outputs/exit codes, credential env, the profile prerequisite, and the "no GUI steps" note. Written for small local models.

## 7. Verification gates

- [ ] `npm run typecheck` (0 errors), `npm test` (all green), `node scripts/scope-wall.mjs` (0 violations).
- [ ] `./scripts/developer-id-release.sh --verify-only` passes.
- [ ] A local build path (`--build-only --skip-notarize`) produces a signed `.app`/`.dmg` + metadata, OR documents the exact failure.
- [ ] `--release` stops at the profile hard gate with the exact missing Apple setup documented (profile not installed this machine).
