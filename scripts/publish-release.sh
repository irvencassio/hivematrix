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
HEAD_SHA="$(git rev-parse HEAD)"
PKG_VERSION="$(python3 -c "import json;print(json.load(open('package.json'))['version'])")"
read -r SRC_VERSION BUILD_NUMBER BUILD_DATE < <(python3 - <<'PY'
import re
s=open('src/lib/version.ts').read()
print(
  re.search(r'export const VERSION = "([^"]+)"', s).group(1),
  re.search(r'export const BUILD_NUMBER = ([0-9]+)', s).group(1),
  re.search(r'export const BUILD_DATE = "([^"]+)"', s).group(1),
)
PY
)

if [ "$PKG_VERSION" != "$VERSION" ] || [ "$SRC_VERSION" != "$VERSION" ]; then
  echo "✗ Version fields disagree: package=$PKG_VERSION tauri=$VERSION src=$SRC_VERSION" >&2
  exit 1
fi

# Never publish new code under a version tag that already points elsewhere.
# Tauri only updates when the advertised version increases; reusing a version
# with different code silently strands installed clients on the older build.
REMOTE_TAG_SHA="$(git ls-remote --tags origin "refs/tags/$TAG^{}" | awk '{print $1}' | head -1)"
if [ -z "$REMOTE_TAG_SHA" ]; then
  REMOTE_TAG_SHA="$(git ls-remote --tags origin "refs/tags/$TAG" | awk '{print $1}' | head -1)"
fi
LOCAL_TAG_SHA="$(git rev-list -n 1 "$TAG" 2>/dev/null || true)"
TAG_SHA="${REMOTE_TAG_SHA:-$LOCAL_TAG_SHA}"
if [ -n "$TAG_SHA" ] && [ "$TAG_SHA" != "$HEAD_SHA" ]; then
  echo "✗ $TAG already points at $TAG_SHA, not current HEAD $HEAD_SHA." >&2
  echo "  Bump package.json, src-tauri/tauri.conf.json, and src/lib/version.ts before publishing." >&2
  exit 1
fi

TARBALL="$(ls -t "$BUNDLE"/macos/*.app.tar.gz 2>/dev/null | head -1 || true)"
SIG="$(ls -t "$BUNDLE"/macos/*.app.tar.gz.sig 2>/dev/null | head -1 || true)"
DMG=""
DMG_ASSET_NAME=""
DMG_INFO="$(node scripts/release-artifacts.mjs dmg-tsv "$BUNDLE" "$VERSION" || true)"
if [ -n "$DMG_INFO" ]; then
  IFS=$'\t' read -r DMG DMG_ASSET_NAME <<< "$DMG_INFO"
fi

[ -n "$TARBALL" ] || { echo "✗ No .app.tar.gz under $BUNDLE/macos — build with createUpdaterArtifacts=true + signing key." >&2; exit 1; }
[ -n "$SIG" ] || { echo "✗ No .sig next to the tarball — TAURI_SIGNING_PRIVATE_KEY was missing at build time." >&2; exit 1; }

BUILT_COMMIT="$(python3 -c "import json;print(json.load(open('$BUNDLE/macos/HiveMatrix.app/Contents/Resources/daemon/build-info.json')).get('sourceCommit') or '')" 2>/dev/null || true)"
BUILT_DIRTY="$(python3 -c "import json;print(json.load(open('$BUNDLE/macos/HiveMatrix.app/Contents/Resources/daemon/build-info.json')).get('sourceDirty'))" 2>/dev/null || true)"
if [ "$BUILT_COMMIT" != "$HEAD_SHA" ]; then
  echo "✗ Built app daemon sourceCommit is '$BUILT_COMMIT', expected current HEAD '$HEAD_SHA'." >&2
  echo "  Re-run bash scripts/build-app.sh from the commit you intend to publish." >&2
  exit 1
fi
if [ "$BUILT_DIRTY" = "True" ] || [ "$BUILT_DIRTY" = "true" ]; then
  echo "✗ Built app was produced from a dirty worktree. Commit or discard changes, rebuild, then publish." >&2
  exit 1
fi

# Asset filenames as they'll appear on the release (gh strips paths).
TARBALL_NAME="$(basename "$TARBALL")"

echo "==> Generating latest.json for $TAG (darwin-aarch64)…"
MANIFEST="$BUNDLE/latest.json"
SIGNATURE="$(cat "$SIG")" \
URL="https://github.com/$REPO/releases/download/$TAG/$TARBALL_NAME" \
VERSION="$VERSION" \
SOURCE_COMMIT="$HEAD_SHA" \
BUILD_NUMBER="$BUILD_NUMBER" \
BUILD_DATE="$BUILD_DATE" \
python3 - "$MANIFEST" <<'PY'
import json, os, sys, datetime
manifest = {
    "version": os.environ["VERSION"],
    "notes": f"HiveMatrix {os.environ['VERSION']}",
    "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "sourceCommit": os.environ["SOURCE_COMMIT"],
    "buildNumber": int(os.environ["BUILD_NUMBER"]),
    "buildDate": os.environ["BUILD_DATE"],
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
if [ -n "$DMG" ]; then
  DMG_UPLOAD="$DMG"
  if [ -n "$DMG_ASSET_NAME" ] && [ "$(basename "$DMG")" != "$DMG_ASSET_NAME" ]; then
    DMG_UPLOAD="$BUNDLE/$DMG_ASSET_NAME"
    cp -f "$DMG" "$DMG_UPLOAD"
  fi
  ASSETS+=("$DMG_UPLOAD")
fi

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "==> Release ${TAG} exists - replacing assets..."
  gh release upload "$TAG" "${ASSETS[@]}" --repo "$REPO" --clobber
else
  echo "==> Creating release ${TAG}..."
    gh release create "$TAG" "${ASSETS[@]}" --repo "$REPO" \
    --title "HiveMatrix $VERSION" \
    --notes "HiveMatrix $VERSION — source commit $HEAD_SHA. Auto-update feed: latest.json (darwin-aarch64)." \
    --latest
fi

echo "==> Verifying live update feed for $TAG..."
VERSION="$VERSION" SOURCE_COMMIT="$HEAD_SHA" python3 - <<'PY'
import json, os, sys, urllib.request
url = "https://github.com/irvencassio/hivematrix/releases/latest/download/latest.json"
with urllib.request.urlopen(url, timeout=20) as r:
    feed = json.load(r)
errors = []
if feed.get("version") != os.environ["VERSION"]:
    errors.append(f"version={feed.get('version')} expected={os.environ['VERSION']}")
if feed.get("sourceCommit") != os.environ["SOURCE_COMMIT"]:
    errors.append(f"sourceCommit={feed.get('sourceCommit')} expected={os.environ['SOURCE_COMMIT']}")
if errors:
    print("✗ live latest.json mismatch: " + "; ".join(errors), file=sys.stderr)
    sys.exit(1)
print("✓ live latest.json matches version + sourceCommit")
PY

echo "✓ Published $TAG. Update feed: https://github.com/$REPO/releases/latest/download/latest.json"
