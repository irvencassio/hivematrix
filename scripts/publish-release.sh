#!/usr/bin/env bash
#
# Publish a built HiveMatrix release to GitHub Releases with the auto-update
# feed. Run AFTER scripts/build-app.sh (which must emit the updater artifacts —
# requires TAURI_SIGNING_PRIVATE_KEY in the build env; see docs/RELEASE.md).
#
#   bash scripts/publish-release.sh            # BETA (the default)
#   bash scripts/publish-release.sh --beta
#   bash scripts/publish-release.sh --stable   # promote to everyone
#
# ── Channels ────────────────────────────────────────────────────────────────
# Beta is the DEFAULT so that shipping a build is cheap and low-risk, and going
# stable is a deliberate act. Same ergonomics as Canopy Terminal's build-dmg.sh.
#
#   --beta    Creates/updates the v<version> release as a PRERELEASE (never
#             "Latest", so neither the website download nor the stable feed can
#             ever resolve to it) and clobbers hivematrix-core-beta.json onto the
#             permanent "$BETA_TAG" pointer release. Stable clients see nothing.
#
#   --stable  Creates/updates the v<version> release as --latest AND writes BOTH
#             feeds: hivematrix-core.json on the release (which is what
#             releases/latest/download/ resolves to, i.e. the stable feed) and
#             hivematrix-core-beta.json on the pointer release, so beta clients
#             are never stranded below the newest stable.
#
# Stable clients poll only the stable feed. Beta clients poll only the beta
# feed — which a stable publish also advances, which is how "beta sees beta AND
# stable" holds with a single URL per client.
#
# Keep the asset names/tag in sync with src/lib/updater/channel.ts,
# src-tauri/src/lib.rs (BETA_FEED_URL) and scripts/verify-autoupdate-release.mts.

set -euo pipefail
cd "$(dirname "$0")/.."

CHANNEL="beta"
while [ $# -gt 0 ]; do
  case "$1" in
    --beta)   CHANNEL="beta" ;;
    --stable) CHANNEL="stable" ;;
    -h|--help) sed -n '1,30p' "$0"; exit 0 ;;
    *) echo "✗ unknown argument: $1 (expected --beta | --stable)" >&2; exit 2 ;;
  esac
  shift
done

REPO="irvencassio/hivematrix"
# Core-identity feed asset. Distinct from the frozen legacy `latest.json` so old
# com.cassio.hivematrix installs never auto-jump across bundle IDs (which would
# reset every macOS TCC grant). Must match the updater endpoint in
# src-tauri/tauri.conf.json and src/lib/updater/channel.ts.
FEED_ASSET="hivematrix-core.json"
BETA_FEED_ASSET="hivematrix-core-beta.json"
# Permanent pointer release carrying the newest beta feed. It exists because a
# beta must never be marked "Latest", and releases/latest/download/ cannot reach
# a prerelease — so the beta feed needs a fixed tag of its own.
BETA_TAG="beta-channel"
STABLE_FEED_URL="https://github.com/$REPO/releases/latest/download/$FEED_ASSET"
BETA_FEED_URL="https://github.com/$REPO/releases/download/$BETA_TAG/$BETA_FEED_ASSET"
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
# Demand an explicit clean flag: sourceDirty prints True / False / None (missing
# field). Anything but a clean False is unknown provenance and must not publish.
if [ "$BUILT_DIRTY" != "False" ] && [ "$BUILT_DIRTY" != "false" ]; then
  echo "✗ Built app worktree flag is '$BUILT_DIRTY' (need sourceDirty=false in the app's build-info.json)." >&2
  echo "  Commit or discard changes, re-run bash scripts/build-app.sh, then publish." >&2
  exit 1
fi

# Asset filenames as they'll appear on the release (gh strips paths).
TARBALL_NAME="$(basename "$TARBALL")"

echo "==> Publishing $TAG on the $CHANNEL channel"
echo "==> Generating the update manifest for $TAG (darwin-aarch64)…"
MANIFEST="$BUNDLE/$FEED_ASSET"
BETA_MANIFEST="$BUNDLE/$BETA_FEED_ASSET"
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
# Both channels advertise the SAME build; only the asset name (and therefore
# which clients can see it) differs. Copying rather than re-generating keeps the
# two feeds byte-identical, so a beta that is later promoted to stable cannot
# quietly change what it advertises.
cp -f "$MANIFEST" "$BETA_MANIFEST"

ASSETS=("$TARBALL" "$SIG")
if [ "$CHANNEL" = "stable" ]; then
  # The stable feed IS the asset on the release marked Latest.
  ASSETS+=("$MANIFEST")
else
  # A beta release must NOT carry hivematrix-core.json: if it were ever marked
  # Latest by hand, stable clients would immediately jump onto a beta build.
  ASSETS+=("$BETA_MANIFEST")
fi
if [ -n "$DMG" ]; then
  DMG_UPLOAD="$DMG"
  if [ -n "$DMG_ASSET_NAME" ] && [ "$(basename "$DMG")" != "$DMG_ASSET_NAME" ]; then
    DMG_UPLOAD="$BUNDLE/$DMG_ASSET_NAME"
    cp -f "$DMG" "$DMG_UPLOAD"
  fi
  ASSETS+=("$DMG_UPLOAD")
fi

# --latest vs --prerelease is the whole safety property of the beta channel: the
# website download and the stable feed both resolve through "Latest", so a beta
# release must never hold it.
if [ "$CHANNEL" = "stable" ]; then
  # Explicit =false so promoting a build that was first published as a beta
  # actually clears the prerelease flag instead of leaving it half-promoted.
  LATEST_FLAGS=(--latest --prerelease=false)
  NOTES="HiveMatrix $VERSION — source commit $HEAD_SHA. Stable channel; auto-update feed: $FEED_ASSET (darwin-aarch64)."
else
  LATEST_FLAGS=(--prerelease --latest=false)
  NOTES="HiveMatrix $VERSION — source commit $HEAD_SHA. BETA channel; auto-update feed: $BETA_FEED_ASSET (darwin-aarch64). Opt in via Settings → Updates → Channel."
fi

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "==> Release ${TAG} exists - replacing assets..."
  gh release upload "$TAG" "${ASSETS[@]}" --repo "$REPO" --clobber
  # An existing release may have been created on the other channel; re-assert.
  gh release edit "$TAG" --repo "$REPO" "${LATEST_FLAGS[@]}" --notes "$NOTES"
else
  echo "==> Creating release ${TAG}..."
  gh release create "$TAG" "${ASSETS[@]}" --repo "$REPO" \
    --title "HiveMatrix $VERSION" \
    --notes "$NOTES" \
    "${LATEST_FLAGS[@]}"
fi

# ── Beta pointer release ────────────────────────────────────────────────────
# Beta clients poll a FIXED url, so the beta feed lives on a permanent pointer
# release whose asset is clobbered every publish. A STABLE publish updates it
# too — otherwise a beta client would sit below the newest stable forever, which
# would break "beta sees beta AND stable".
echo "==> Updating the $BETA_TAG pointer release with $BETA_FEED_ASSET…"
if ! gh release view "$BETA_TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release create "$BETA_TAG" --repo "$REPO" \
    --target "$HEAD_SHA" \
    --title "Beta channel feed" \
    --notes "Pointer release. Carries only $BETA_FEED_ASSET — the update feed beta clients poll. Not a downloadable build; the builds themselves live on their own v<version> releases. Never mark this Latest." \
    --prerelease --latest=false
fi
gh release upload "$BETA_TAG" "$BETA_MANIFEST" --repo "$REPO" --clobber

echo "==> Verifying the live $CHANNEL update feed for $TAG..."
if [ "$CHANNEL" = "stable" ]; then VERIFY_URL="$STABLE_FEED_URL"; else VERIFY_URL="$BETA_FEED_URL"; fi
VERSION="$VERSION" SOURCE_COMMIT="$HEAD_SHA" VERIFY_URL="$VERIFY_URL" python3 - <<'PY'
import json, os, sys, urllib.request
# Cache-bust for the same reason feed-check.ts does: GitHub's asset CDN can
# serve a previous copy for minutes after a publish.
url = os.environ["VERIFY_URL"] + "?t=" + str(int(__import__("time").time()))
req = urllib.request.Request(url, headers={"Cache-Control": "no-cache", "Pragma": "no-cache"})
with urllib.request.urlopen(req, timeout=20) as r:
    feed = json.load(r)
errors = []
if feed.get("version") != os.environ["VERSION"]:
    errors.append(f"version={feed.get('version')} expected={os.environ['VERSION']}")
if feed.get("sourceCommit") != os.environ["SOURCE_COMMIT"]:
    errors.append(f"sourceCommit={feed.get('sourceCommit')} expected={os.environ['SOURCE_COMMIT']}")
if errors:
    print("✗ live feed mismatch: " + "; ".join(errors), file=sys.stderr)
    sys.exit(1)
print("✓ live feed matches version + sourceCommit")
PY

if [ "$CHANNEL" = "stable" ]; then
  echo "✓ Published $TAG to STABLE. Stable feed: $STABLE_FEED_URL · beta feed also advanced: $BETA_FEED_URL"
else
  echo "✓ Published $TAG to BETA (prerelease). Beta feed: $BETA_FEED_URL · stable feed untouched: $STABLE_FEED_URL"
fi
