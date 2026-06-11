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

NOTARY_PROFILE="hivematrix"
# shellcheck disable=SC1090
source "$HOME/.cargo/env"

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

echo "==> Submitting to Apple notary service (a few minutes)…"
xcrun notarytool submit "$TARGET" --keychain-profile "$NOTARY_PROFILE" --wait

echo "==> Stapling…"
# Staple the real bundle (.app), and the .dmg too if present.
xcrun stapler staple "$APP"
[ -n "$DMG" ] && xcrun stapler staple "$DMG" || true

echo "==> Gatekeeper assessment…"
spctl --assess --type execute --verbose=2 "$APP" 2>&1 | tail -2

# Distributable zip of the stapled app.
DIST="src-tauri/target/release/bundle/HiveMatrix.app.zip"
ditto -c -k --keepParent "$APP" "$DIST"
echo "✓ Done. Notarized + stapled. Distributable: $DIST"
