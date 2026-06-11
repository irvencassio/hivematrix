#!/usr/bin/env bash
#
# Build, bundle, and sign DesktopBeeHelper.app.
#
#   bash build-app.sh
#
# A proper .app bundle gives the helper a stable TCC identity (bundle id +
# Developer ID requirement), so Accessibility / Screen Recording grants persist
# across rebuilds and the helper can be launchd-supervised like a real app.

set -euo pipefail
cd "$(dirname "$0")"

IDENTITY="Developer ID Application: Irven Cassio (8B3CHTY93V)"
APP="DesktopBeeHelper.app"
BIN_NAME="DesktopBeeHelper"

echo "==> swift build -c release"
# shellcheck disable=SC1090
source "$HOME/.cargo/env" 2>/dev/null || true
swift build -c release

echo "==> Assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp ".build/release/$BIN_NAME" "$APP/Contents/MacOS/$BIN_NAME"
cp "Resources/Info.plist" "$APP/Contents/Info.plist"

echo "==> Signing (Developer ID + hardened runtime + entitlements)"
codesign --force --options runtime \
  --entitlements "Resources/entitlements.plist" \
  --sign "$IDENTITY" \
  --timestamp \
  "$APP"

echo "==> Verifying"
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | tail -2
codesign -dvv "$APP" 2>&1 | grep -E "Identifier=|Authority=Developer ID|flags=.*runtime|TeamIdentifier" | head -4

echo "✓ Built + signed: $(pwd)/$APP"
echo "  Executable: $(pwd)/$APP/Contents/MacOS/$BIN_NAME"
