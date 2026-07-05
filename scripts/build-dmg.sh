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
# Notary credentials resolved centrally (sets NOTARY_ARGS + NOTARY_MECHANISM).
# shellcheck source=scripts/notary-credentials.sh
source "$(dirname "$0")/notary-credentials.sh"
resolve_notary_args
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

if [ -n "${HM_SKIP_NOTARIZE:-}" ]; then
  echo "==> HM_SKIP_NOTARIZE set — local dry run: .dmg is SIGNED but NOT notarized/stapled."
  echo "✓ Signed (un-notarized) .dmg: $OUT"
else
  echo "==> Notary credential mechanism: $NOTARY_MECHANISM"
  if [ "$NOTARY_MECHANISM" = "none" ]; then
    echo "✗ No notary credentials (set NOTARYTOOL_KEYCHAIN_PROFILE, the hivematrix profile, or APPLE_ID+APPLE_APP_SPECIFIC_PASSWORD)." >&2
    exit 1
  fi
  echo "==> Notarizing (waits for Apple)"
  xcrun notarytool submit "$OUT" "${NOTARY_ARGS[@]}" --wait

  echo "==> Stapling + verifying"
  xcrun stapler staple "$OUT"
  xcrun stapler validate "$OUT"
  spctl --assess --type open --context context:primary-signature -v "$OUT" 2>&1 | tail -2

  echo "✓ Notarized .dmg: $OUT"
fi
