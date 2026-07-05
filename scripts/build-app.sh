#!/usr/bin/env bash
#
# Build, sign, notarize, and staple the HiveMatrix macOS app.
#
#   bash scripts/build-app.sh
#
# Prereqs (one-time): Rust + cargo-tauri, the "Developer ID Application" cert
# (present), and the notarytool keychain profile "hivematrix"
# (run scripts/setup-notary.sh once). Signing identity is in
# src-tauri/tauri.conf.json.
#
# Notarizes the .dmg if Tauri produced one; otherwise falls back to notarizing
# the signed .app directly (the dmg step uses Finder/AppleScript automation and
# can fail in a headless/no-GUI session — the .app is the real artifact either
# way). Produces a stapled, Gatekeeper-accepted bundle + a distributable zip.

set -euo pipefail
cd "$(dirname "$0")/.."

IDENTITY="Developer ID Application: Irven Cassio (8B3CHTY93V)"
# Notary credentials resolved centrally (env override or default keychain
# profile), so the mechanism is chosen + printed in one place. Sets NOTARY_ARGS
# + NOTARY_MECHANISM.
# shellcheck source=scripts/notary-credentials.sh
source "$(dirname "$0")/notary-credentials.sh"
resolve_notary_args
if [ "$NOTARY_MECHANISM" = "none" ] && [ -z "${HM_SKIP_NOTARIZE:-}" ]; then
  echo "✗ No notary credentials. Set NOTARYTOOL_KEYCHAIN_PROFILE, install the 'hivematrix'" >&2
  echo "  keychain profile (scripts/setup-notary.sh), or export APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD." >&2
  exit 1
fi
echo "==> Notary credential mechanism: $NOTARY_MECHANISM"
# shellcheck disable=SC1090
source "$HOME/.cargo/env"

echo "==> Building the self-contained daemon runtime (bundled Node + addon)…"
# Must run before cargo tauri build so Tauri picks up dist/daemon as a resource.
npm run build:daemon
npm run verify:daemon-runtime

echo "==> Building standalone lane app artifacts…"
node scripts/package-browser-lane-app.mjs
node scripts/package-terminal-lane-app.mjs

# Sign the SOURCE resources before bundling: cargo tauri build packages the dmg
# and the updater tarball mid-build, straight from these files — signing only
# the bundled copies afterwards ships unsigned Mach-Os in those artifacts and
# notarization rejects the dmg.
echo "==> Pre-signing source resources (so dmg/updater artifacts are valid)…"
bash scripts/sign-bundled-machos.sh dist/daemon desktopbee-helper/DesktopBeeHelper.app
echo "==> Signing standalone lane app artifacts…"
codesign --force --options runtime --timestamp --sign "$IDENTITY" --entitlements browser-lane-app/Resources/entitlements.plist "build/browser-lane/Browser Lane.app/Contents/MacOS/BrowserLane"
codesign --force --options runtime --timestamp --sign "$IDENTITY" --entitlements browser-lane-app/Resources/entitlements.plist "build/browser-lane/Browser Lane.app"
codesign --force --options runtime --timestamp --sign "$IDENTITY" --entitlements terminal-lane-app/Resources/entitlements.plist "build/terminal-lane/Terminal Lane.app/Contents/MacOS/TerminalLane"
codesign --force --options runtime --timestamp --sign "$IDENTITY" --entitlements terminal-lane-app/Resources/entitlements.plist "build/terminal-lane/Terminal Lane.app"

echo "==> Building + signing (cargo tauri build)…"
# Don't abort the whole script if only the dmg sub-step fails; we check artifacts next.
cargo tauri build || echo "   (cargo tauri build returned non-zero — checking artifacts; dmg packaging may have failed)"

APP="$(ls -dt src-tauri/target/release/bundle/macos/*.app 2>/dev/null | head -1 || true)"
DMG="$(ls -t src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null | head -1 || true)"

if [ -z "$APP" ]; then
  echo "✗ No .app produced — build failed." >&2
  exit 1
fi
echo "==> App: $APP"

# Resources were pre-signed BEFORE bundling and Tauri sealed the outer app over
# them — do NOT re-sign anything here. Any post-build re-sign changes the .app's
# cdhash away from the copy inside the already-packaged dmg, so the notarization
# ticket for the dmg's contents would no longer match the on-disk .app and
# stapling it fails with "Record not found".
echo "==> Verifying signature + hardened runtime…"
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | tail -2
codesign -dvv "$APP" 2>&1 | grep -E "Authority=Developer ID|flags=.*runtime|TeamIdentifier" || true

# Prefer the dmg for notarization/distribution; fall back to the .app.
if [ -n "$DMG" ]; then
  TARGET="$DMG"
else
  echo "==> No .dmg (cosmetic packaging step likely failed) — notarizing the .app."
  TARGET="/tmp/HiveMatrix-notarize.zip"
  ditto -c -k --keepParent "$APP" "$TARGET"
fi

if [ -n "${HM_SKIP_NOTARIZE:-}" ]; then
  echo "==> HM_SKIP_NOTARIZE set — local dry run: app is SIGNED but NOT notarized/stapled."
  echo "    (Do not distribute this build; Gatekeeper will reject it on other machines.)"
else
  echo "==> Submitting to Apple notary service (a few minutes)…"
  xcrun notarytool submit "$TARGET" "${NOTARY_ARGS[@]}" --wait

  echo "==> Stapling…"
  # Staple the real bundle (.app), and the .dmg too if present.
  xcrun stapler staple "$APP"
  [ -n "$DMG" ] && xcrun stapler staple "$DMG" || true

  echo "==> Gatekeeper assessment…"
  spctl --assess --type execute --verbose=2 "$APP" 2>&1 | tail -2
fi

# Regenerate the updater artifact from the FINAL app (re-sealed + stapled) and
# re-sign it with the updater key — the tarball Tauri emitted mid-build
# predates the staple. Picks up the key from the TAURI_SIGNING_PRIVATE_KEY(+
# _PASSWORD) env vars cargo tauri signer reads natively.
if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]; then
  echo "==> Regenerating updater artifact from the stapled app…"
  TARBALL="$(dirname "$APP")/$(basename "$APP").tar.gz"
  # COPYFILE_DISABLE=1 stops macOS tar from embedding AppleDouble (._*) entries
  # for extended attributes. Tauri's updater unpacks with a non-Apple tar reader
  # that treats those ._* entries as real files and fails ("failed to unpack
  # ._HiveMatrix.app") — which silently broke EVERY auto-update before this.
  COPYFILE_DISABLE=1 tar -czf "$TARBALL" -C "$(dirname "$APP")" "$(basename "$APP")"
  cargo tauri signer sign "$TARBALL"
  echo "   Updater artifact: $TARBALL (+ .sig)"
fi

# Distributable zip of the (stapled, unless dry-run) app.
DIST="src-tauri/target/release/bundle/HiveMatrix.app.zip"
ditto -c -k --keepParent "$APP" "$DIST"
if [ -n "${HM_SKIP_NOTARIZE:-}" ]; then
  echo "✓ Done (signed, NOT notarized — local dry run). Distributable: $DIST"
else
  echo "✓ Done. Notarized + stapled. Distributable: $DIST"
fi
