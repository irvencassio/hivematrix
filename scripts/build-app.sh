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
IDENTITY="Developer ID Application: Irven Cassio (8B3CHTY93V)"
APP_ENT="src-tauri/entitlements/app.entitlements.plist"
# shellcheck disable=SC1090
source "$HOME/.cargo/env"

echo "==> Building the self-contained daemon runtime (bundled Node + addon)…"
# Must run before cargo tauri build so Tauri picks up dist/daemon as a resource.
npm run build:daemon

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

# Tauri signs the outer app, but the binaries we injected as resources (the
# bundled Node, better_sqlite3.node, the nested DesktopBeeHelper.app) need OUR
# Developer ID + hardened runtime + the right entitlements, or notarization
# rejects them. Sign inside-out: inner Mach-Os first, then re-seal the outer app.
echo "==> Signing bundled inner Mach-Os…"
bash scripts/sign-bundled-machos.sh "$APP"

echo "==> Re-sealing the outer app (preserves inner signatures)…"
codesign --force --options runtime --timestamp --entitlements "$APP_ENT" --sign "$IDENTITY" "$APP"

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
