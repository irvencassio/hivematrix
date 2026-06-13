#!/usr/bin/env bash
#
# Publish a built HiveMatrix release to GitHub Releases with the auto-update
# feed. Run AFTER scripts/build-app.sh (which must emit the updater artifacts —
# requires TAURI_SIGNING_PRIVATE_KEY in the build env; see docs/RELEASE.md).
#
#   bash scripts/publish-release.sh
#
# Uploads to the v<version> tag: the .dmg, HiveMatrix.app.tar.gz, its .sig, and
# a generated latest.json. The in-app updater fetches
# releases/latest/download/latest.json, so the newest published release is the
# live update feed.

set -euo pipefail
cd "$(dirname "$0")/.."

REPO="irvencassio/hivematrix"
VERSION="$(python3 -c "import json;print(json.load(open('src-tauri/tauri.conf.json'))['version'])")"
TAG="v$VERSION"
BUNDLE="src-tauri/target/release/bundle"

TARBALL="$(ls -t "$BUNDLE"/macos/*.app.tar.gz 2>/dev/null | head -1 || true)"
SIG="$(ls -t "$BUNDLE"/macos/*.app.tar.gz.sig 2>/dev/null | head -1 || true)"
DMG="$(ls -t "$BUNDLE"/dmg/*.dmg 2>/dev/null | head -1 || true)"

[ -n "$TARBALL" ] || { echo "✗ No .app.tar.gz under $BUNDLE/macos — build with createUpdaterArtifacts=true + signing key." >&2; exit 1; }
[ -n "$SIG" ] || { echo "✗ No .sig next to the tarball — TAURI_SIGNING_PRIVATE_KEY was missing at build time." >&2; exit 1; }

# Asset filenames as they'll appear on the release (gh strips paths).
TARBALL_NAME="$(basename "$TARBALL")"

echo "==> Generating latest.json for $TAG (darwin-aarch64)…"
MANIFEST="$BUNDLE/latest.json"
SIGNATURE="$(cat "$SIG")" \
URL="https://github.com/$REPO/releases/download/$TAG/$TARBALL_NAME" \
VERSION="$VERSION" \
python3 - "$MANIFEST" <<'PY'
import json, os, sys, datetime
manifest = {
    "version": os.environ["VERSION"],
    "notes": f"HiveMatrix {os.environ['VERSION']}",
    "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "platforms": {
        "darwin-aarch64": {
            "signature": os.environ["SIGNATURE"],
            "url": os.environ["URL"],
        }
    },
}
with open(sys.argv[1], "w") as f:
    json.dump(manifest, f, indent=2)
PY
cat "$MANIFEST"

ASSETS=("$TARBALL" "$SIG" "$MANIFEST")
[ -n "$DMG" ] && ASSETS+=("$DMG")

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "==> Release ${TAG} exists - replacing assets..."
  gh release upload "$TAG" "${ASSETS[@]}" --repo "$REPO" --clobber
else
  echo "==> Creating release ${TAG}..."
  gh release create "$TAG" "${ASSETS[@]}" --repo "$REPO" \
    --title "HiveMatrix $VERSION" \
    --notes "HiveMatrix $VERSION — see commit history for changes. Auto-update feed: latest.json (darwin-aarch64)." \
    --latest
fi

echo "✓ Published $TAG. Update feed: https://github.com/$REPO/releases/latest/download/latest.json"
