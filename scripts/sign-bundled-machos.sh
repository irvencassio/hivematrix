#!/usr/bin/env bash
#
# Sign every Mach-O we bundle into HiveMatrix.app with our Developer ID under
# hardened runtime. Notarization inspects ALL nested binaries — the official
# Node binary is signed by the Node Foundation, so it MUST be re-signed by us or
# notarization rejects the foreign signature.
#
#   bash scripts/sign-bundled-machos.sh <daemon-dir> <helper.app>
#
# Called twice by build-app.sh:
#   1. PRE-build on the source resources (dist/daemon,
#      desktopbee-helper/DesktopBeeHelper.app) so the dmg + updater tarball
#      that `cargo tauri build` packages mid-build already contain valid
#      signatures (it bundles them verbatim before our post-build pass runs).
#   2. POST-build on the bundled copies inside the .app (belt and braces; the
#      outer app is re-sealed afterwards).
# Signs inside-out (deepest first) so the later outer re-sign in build-app.sh
# seals over valid inner signatures. Idempotent (--force).

set -euo pipefail
cd "$(dirname "$0")/.."

DAEMON_DIR="${1:?usage: sign-bundled-machos.sh <daemon-dir> <helper.app>}"
HELPER="${2:?usage: sign-bundled-machos.sh <daemon-dir> <helper.app>}"
IDENTITY="Developer ID Application: Irven Cassio (8B3CHTY93V)"
DAEMON_ENT="src-tauri/entitlements/daemon.entitlements.plist"
PYTHON_ENT="src-tauri/entitlements/python.entitlements.plist"
HELPER_ENT="desktopbee-helper/Resources/entitlements.plist"

sign() { codesign --force --options runtime --timestamp --sign "$IDENTITY" "$@"; }

echo "==> Signing bundled Node + native addon (daemon entitlements)"
sign --entitlements "$DAEMON_ENT" "$DAEMON_DIR/bin/node"
# Native .node addons are dlopen'd dylibs — sign with hardened runtime, no entitlements.
while IFS= read -r -d '' addon; do
  echo "    $addon"
  sign "$addon"
done < <(find "$DAEMON_DIR" -name "*.node" -print0)

# Bundled standalone Python (#4c): sign every nested Mach-O so notarization
# accepts the app, then sign the interpreter executables LAST with the python
# entitlements (disable-library-validation, so they can load the venv's MLX .so).
# Signs .so/.dylib first (deepest), executables after, mirroring inside-out order.
if [ -d "$DAEMON_DIR/python" ]; then
  echo "==> Signing bundled Python libraries (.so/.dylib)"
  while IFS= read -r -d '' lib; do
    sign "$lib"
  done < <(find "$DAEMON_DIR/python" \( -name "*.so" -o -name "*.dylib" \) -print0)

  echo "==> Signing bundled Python interpreter binaries (python entitlements)"
  # The real Mach-O interpreters live in python/bin (python3 is a symlink to the
  # versioned binary). Sign every non-symlink executable Mach-O there.
  while IFS= read -r -d '' bin; do
    if file "$bin" | grep -q "Mach-O"; then
      echo "    $bin"
      sign --entitlements "$PYTHON_ENT" "$bin"
    fi
  done < <(find "$DAEMON_DIR/python/bin" -type f -perm -u+x -print0)
fi

echo "==> Signing DesktopBeeHelper.app (its own entitlements)"
if [ -d "$HELPER" ]; then
  sign --entitlements "$HELPER_ENT" "$HELPER/Contents/MacOS/DesktopBeeHelper"
  sign --entitlements "$HELPER_ENT" "$HELPER"
else
  echo "    (no helper found at $HELPER — skipping)"
fi

echo "✓ Inner Mach-Os signed."
