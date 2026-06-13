# HiveMatrix Autoupdate Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Task 1: Verify Current Updater Wiring

- [ ] Read `src-tauri/src/lib.rs`.
- [ ] Confirm `check_for_update` calls the Tauri updater and invokes
  `download_and_install`.
- [ ] Read `src-tauri/tauri.conf.json`.
- [ ] Confirm `plugins.updater.endpoints` points at the intended production
  feed and `bundle.createUpdaterArtifacts` is true.
- [ ] Verification command:

```bash
python3 - <<'PY'
import json
c=json.load(open("src-tauri/tauri.conf.json"))
assert c["bundle"]["createUpdaterArtifacts"] is True
assert c["plugins"]["updater"]["endpoints"][0].startswith("https://")
assert c["plugins"]["updater"]["pubkey"]
PY
```

## Task 2: Verify Release Feed Reachability

- [ ] Fetch the updater endpoint without credentials.
- [ ] Parse `latest.json`.
- [ ] Fetch the `darwin-aarch64.url` without credentials.
- [ ] Expected failing test before changing channel visibility or host:

```bash
curl -fsSL https://github.com/irvencassio/hivematrix/releases/latest/download/latest.json >/tmp/hm-latest.json
python3 - <<'PY'
import json
m=json.load(open("/tmp/hm-latest.json"))
assert "darwin-aarch64" in m["platforms"]
print(m["platforms"]["darwin-aarch64"]["url"])
PY
```

## Task 3: Choose Public Channel Path

- [ ] If existing `0.1.1` installs must update without reinstall, make the
  existing GitHub release URL public by making the repo public.
- [ ] If the source repo must remain private, create/use a public binary channel
  and update `src-tauri/tauri.conf.json` plus `scripts/publish-release.sh`.
- [ ] Do not change repository visibility without explicit owner confirmation.

## Task 4: Build And Notarize Release Artifact

- [ ] Export `TAURI_SIGNING_PRIVATE_KEY`.
- [ ] Export `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- [ ] Run `bash scripts/build-app.sh`.
- [ ] Verify:

```bash
codesign --verify --deep --strict --verbose=2 src-tauri/target/release/bundle/macos/HiveMatrix.app
xcrun stapler validate src-tauri/target/release/bundle/macos/HiveMatrix.app
xcrun stapler validate src-tauri/target/release/bundle/dmg/HiveMatrix_0.1.1_aarch64.dmg
spctl --assess --type execute --verbose=2 src-tauri/target/release/bundle/macos/HiveMatrix.app
```

## Task 5: Publish And Verify Release

- [ ] Run `bash scripts/publish-release.sh`.
- [ ] Fetch the production `latest.json` anonymously.
- [ ] Fetch the tarball URL anonymously.
- [ ] Confirm the GitHub release contains `.dmg`, `.app.tar.gz`, `.sig`, and
  `latest.json`.

## Task 6: Final Gates

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `node scripts/scope-wall.mjs`.
- [ ] For local-model changes only, run `npx tsx scripts/qwen-readiness.mts`.
