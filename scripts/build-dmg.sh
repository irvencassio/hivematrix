#!/usr/bin/env bash
#
# Build a notarized, stapled drag-to-install .dmg for HiveMatrix.
#
#   bash scripts/build-dmg.sh [version]
#
# Uses hdiutil (not Tauri's create-dmg / Finder-AppleScript layout, which needs
# an attached GUI session). Produces a plain "drag to Applications" .dmg, signs
# it, notarizes via the `hivematrix` keychain profile, and staples.
#
# Prereqs: a built+signed HiveMatrix.app (cargo tauri build), Developer ID cert,
# notarytool profile `hivematrix` (scripts/setup-notary.sh).

set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-0.1.0}"
IDENTITY="Developer ID Application: Irven Cassio (8B3CHTY93V)"
NOTARY_APPLE_ID="cassio.irv@gmail.com"
NOTARY_TEAM_ID="8B3CHTY93V"   # Developer ID Application: Irven Cassio
NOTARY_PROFILE="hivematrix"
NOTARY_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
NOTARY_ARGS=(
  --apple-id "$NOTARY_APPLE_ID"
  --team-id "$NOTARY_TEAM_ID"
  --keychain-profile "$NOTARY_PROFILE"
  --keychain "$NOTARY_KEYCHAIN"
)
APP="src-tauri/target/release/bundle/macos/HiveMatrix.app"
STAGE_ROOT="$(mktemp -d)"
STAGE="$STAGE_ROOT/dmg"
trap 'rm -rf "$STAGE_ROOT"' EXIT
OUT="src-tauri/target/release/bundle/HiveMatrix-${VERSION}.dmg"

[ -d "$APP" ] || { echo "✗ $APP not found — run 'cargo tauri build' first" >&2; exit 1; }

echo "==> Staging app + /Applications symlink"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

echo "==> hdiutil create"
rm -f "$OUT"
hdiutil create -volname "HiveMatrix" -srcfolder "$STAGE" -ov -format UDZO "$OUT"

echo "==> Signing the .dmg"
codesign --force --sign "$IDENTITY" --timestamp "$OUT"

echo "==> Notarizing (waits for Apple)"
xcrun notarytool submit "$OUT" "${NOTARY_ARGS[@]}" --wait

echo "==> Stapling + verifying"
xcrun stapler staple "$OUT"
xcrun stapler validate "$OUT"
spctl --assess --type open --context context:primary-signature -v "$OUT" 2>&1 | tail -2

echo "✓ Notarized .dmg: $OUT"
