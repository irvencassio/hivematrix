#!/usr/bin/env bash
#
# Sign every Mach-O bundled inside HiveMatrix.app with our Developer ID under
# hardened runtime. Notarization inspects ALL nested binaries — the official
# Node binary is signed by the Node Foundation, so it MUST be re-signed by us or
# notarization rejects the foreign signature.
#
#   bash scripts/sign-bundled-machos.sh <path-to-HiveMatrix.app>
#
# Signs inside-out (deepest first) so the later outer re-sign in build-app.sh
# seals over valid inner signatures. Idempotent (--force).

set -euo pipefail
cd "$(dirname "$0")/.."

APP="${1:?usage: sign-bundled-machos.sh <HiveMatrix.app>}"
IDENTITY="Developer ID Application: Irven Cassio (8B3CHTY93V)"
DAEMON_ENT="src-tauri/entitlements/daemon.entitlements.plist"
HELPER_ENT="desktopbee-helper/Resources/entitlements.plist"

sign() { codesign --force --options runtime --timestamp --sign "$IDENTITY" "$@"; }

echo "==> Signing bundled Node + native addon (daemon entitlements)"
sign --entitlements "$DAEMON_ENT" "$APP/Contents/Resources/daemon/bin/node"
# Native .node addons are dlopen'd dylibs — sign with hardened runtime, no entitlements.
while IFS= read -r -d '' addon; do
  echo "    $addon"
  sign "$addon"
done < <(find "$APP/Contents/Resources/daemon" -name "*.node" -print0)

echo "==> Signing nested DesktopBeeHelper.app (its own entitlements)"
HELPER="$APP/Contents/Resources/DesktopBeeHelper.app"
if [ -d "$HELPER" ]; then
  sign --entitlements "$HELPER_ENT" "$HELPER/Contents/MacOS/DesktopBeeHelper"
  sign --entitlements "$HELPER_ENT" "$HELPER"
else
  echo "    (no nested helper found at $HELPER — skipping)"
fi

echo "✓ Inner Mach-Os signed. The outer app must be re-signed after this."
