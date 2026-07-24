#!/usr/bin/env bash
#
# developer-id-release.sh — the ONE canonical HiveMatrix macOS release command.
# Deterministic, non-interactive, callable by any worker model (Claude, Codex,
# Qwen/local). Developer ID signing + Apple notarization for the public
# website DMG / external updater lane. NOT the Mac App Store.
#
# Usage:
#   ./scripts/developer-id-release.sh --verify-only
#   ./scripts/developer-id-release.sh --build-only [--skip-notarize]
#   ./scripts/developer-id-release.sh --release [--stable] [--marketing-version X.Y.Z]
#
# Flags:
#   --verify-only              gates + prereqs only; no build, no bump  (exit 0/1)
#   --build-only|--archive-only build a signed (notarized) .app+.dmg locally; no publish, no commit
#   --release                  full: bump -> build -> notarize -> staple -> publish feed -> verify
#   --beta                     publish to the BETA channel (DEFAULT)
#   --stable                   publish to the STABLE channel — what the website
#                              download and every non-opted-in install receive
#   --marketing-version X.Y.Z  set the marketing version (else auto patch-bump on --release)
#   --skip-notarize            local dry run only; REFUSED with --release
#
# Exit codes: 0 ok · 1 prerequisite/step failure · 2 bad usage/arguments.
#
# Design: docs/superpowers/specs/2026-07-05-developer-id-release-design.md
# Docs:   docs/agent-commands/developer-id-release.md

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Identity (Developer ID; NOT App Store) ──────────────────────────────────
PRODUCT="HiveMatrix"
BUNDLE_ID="com.irvcassio.hivematrix.core"
TEAM_ID="8B3CHTY93V"
IDENTITY="Developer ID Application: Irven Cassio (8B3CHTY93V)"
PROFILE_NAME="HiveMatrix Core"
OUT_ROOT="build/developer-id"

MODE=""
MARKETING_VERSION=""
SKIP_NOTARIZE=0
# Beta by default: shipping a build is cheap, promoting it to everyone is the
# deliberate act. Mirrors Canopy Terminal's build-dmg.sh --stable/--beta.
CHANNEL="beta"
NOTE="Developer ID release"

die()  { echo "✗ developer-id-release: $*" >&2; exit 1; }
step() { echo; echo "=== $* ==="; }
usage() {
  cat <<'EOF'
developer-id-release.sh — canonical HiveMatrix macOS Developer ID release command.

Usage:
  ./scripts/developer-id-release.sh --verify-only
  ./scripts/developer-id-release.sh --build-only [--skip-notarize]
  ./scripts/developer-id-release.sh --release [--stable] [--marketing-version X.Y.Z] [--note "text"]

Flags:
  --verify-only               prereqs + gates only; no build, no bump
  --build-only | --archive-only   build a signed (notarized) .app+.dmg locally; no publish/commit
  --release                   full: bump -> build -> notarize -> staple -> publish feed -> verify
  --beta                      publish to the BETA channel (DEFAULT)
  --stable                    publish to the STABLE channel (website download + everyone not opted in)
  --marketing-version X.Y.Z   set the marketing version (else auto patch-bump on --release)
  --skip-notarize             local dry run only; REFUSED with --release
  --note "text"               release note (changelog + commit message)

Exit codes: 0 ok · 1 prerequisite/step failure · 2 bad usage/arguments.
EOF
}

# ── Argument parsing (fail fast, exit 2 on bad usage) ───────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --verify-only)                 MODE="verify" ;;
    --build-only|--archive-only)   MODE="build" ;;
    --release)                     MODE="release" ;;
    --beta)                        CHANNEL="beta" ;;
    --stable)                      CHANNEL="stable" ;;
    --marketing-version)           MARKETING_VERSION="${2:-}"; shift ;;
    --marketing-version=*)         MARKETING_VERSION="${1#*=}" ;;
    --note)                        NOTE="${2:-}"; shift ;;
    --note=*)                      NOTE="${1#*=}" ;;
    --skip-notarize)               SKIP_NOTARIZE=1 ;;
    -h|--help)                     usage; exit 0 ;;
    *) echo "✗ unknown argument: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

[[ -n "$MODE" ]] || { echo "✗ one of --verify-only / --build-only / --release is required" >&2; usage; exit 2; }
if [[ "$MODE" == "release" && "$SKIP_NOTARIZE" == 1 ]]; then
  echo "✗ --skip-notarize is a local dry-run flag and cannot be combined with --release" >&2
  exit 2
fi

SKIP_LABEL=""; [[ "$SKIP_NOTARIZE" == 1 ]] && SKIP_LABEL=" (skip-notarize)"
echo "HiveMatrix Developer ID release"
echo "  product   : $PRODUCT"
echo "  bundle id : $BUNDLE_ID"
echo "  team      : $TEAM_ID"
echo "  identity  : $IDENTITY"
echo "  mode      : $MODE$SKIP_LABEL"
echo "  channel   : $CHANNEL"

# ── Credential mechanism (printed, never the secret) ────────────────────────
# shellcheck source=scripts/notary-credentials.sh
source "scripts/notary-credentials.sh"
resolve_notary_args
echo "  notary    : $NOTARY_MECHANISM"

# ── Prerequisite gate ───────────────────────────────────────────────────────
step "Prerequisites"

# Signing identity present.
if ! security find-identity -v -p codesigning 2>/dev/null | grep -q "$IDENTITY"; then
  die "signing identity not found in keychain: $IDENTITY"
fi
echo "✓ signing identity present"

# Notary credentials must resolve unless this is an explicit dry run.
if [[ "$SKIP_NOTARIZE" == 0 ]]; then
  [[ "$NOTARY_MECHANISM" != "none" ]] || die "no notary credentials — set NOTARYTOOL_KEYCHAIN_PROFILE, install the 'hivematrix' keychain profile (scripts/setup-notary.sh), or export APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD"
  echo "✓ notary credentials resolvable"
fi

# Provisioning-profile HARD GATE (release only).
if [[ "$MODE" == "release" ]]; then
  if node scripts/verify-provisioning-profile.mjs; then
    echo "✓ '$PROFILE_NAME' Developer ID provisioning profile verified"
  else
    die "provisioning-profile gate failed (see message above). Install the '$PROFILE_NAME' Developer ID profile for $BUNDLE_ID, then retry."
  fi
fi

# Git posture (release only): on main, clean tree.
if [[ "$MODE" == "release" ]]; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
  [[ "$branch" == "main" ]] || die "must be on 'main' to --release (on '$branch')"
  [[ -z "$(git status --porcelain)" ]] || die "working tree is dirty — commit or stash before --release"
  echo "✓ on main, clean tree"

  # Release-note phase-gate governance (docs/GATES.md): a note claiming "Phase N"
  # must be marked PASSED. Previously enforced by release.mjs.
  node scripts/gates-check.mjs "$NOTE" || die "release note phase-gate claim not satisfied (see docs/GATES.md)"
  echo "✓ release-note gate check passed"

  # Tauri updater signing key — installed apps can't verify updates without it.
  [[ -f "$HOME/.hivematrix/tauri-updater.key" && -f "$HOME/.hivematrix/tauri-updater.key.password" ]] \
    || die "missing Tauri updater key (~/.hivematrix/tauri-updater.key + .password)"
  echo "✓ updater signing key present"
fi

# ── Sanity gates (all modes) ────────────────────────────────────────────────
step "Gates: typecheck + tests + scope-wall"
npm run typecheck
npm test
node scripts/scope-wall.mjs
echo "✓ gates passed"

if [[ "$MODE" == "verify" ]]; then
  step "verify-only complete"
  echo "✓ Prerequisites + gates pass. (No build performed; live-feed proof runs only on --release.)"
  exit 0
fi

# ── Version / build number ──────────────────────────────────────────────────
step "Version + build number"
CUR_VERSION="$(python3 -c "import json;print(json.load(open('src-tauri/tauri.conf.json'))['version'])")"
if [[ -n "$MARKETING_VERSION" ]]; then
  TARGET_VERSION="$MARKETING_VERSION"
elif [[ "$MODE" == "release" ]]; then
  TARGET_VERSION="$(node -e 'import("./scripts/release-version.mjs").then(m=>console.log(m.bumpPatch(process.argv[1])))' "$CUR_VERSION")"
else
  # --build-only without an explicit version: build the current version in place
  # (dry/local artifact). Do NOT bump/commit.
  TARGET_VERSION="$CUR_VERSION"
fi
echo "current=$CUR_VERSION target=$TARGET_VERSION"

# For --release, never reuse an existing tag.
if [[ "$MODE" == "release" ]]; then
  ! git rev-parse -q --verify "refs/tags/v$TARGET_VERSION" >/dev/null 2>&1 || die "tag v$TARGET_VERSION already exists — pick a new --marketing-version"
fi

# Apply version files. For --release (or an explicit --marketing-version) this
# increments BUILD_NUMBER; for a plain --build-only it stays in place.
if [[ "$MODE" == "release" || -n "$MARKETING_VERSION" ]]; then
  APPLIED="$(node scripts/release-version.mjs "$TARGET_VERSION" "$NOTE")"
  BUILD_NUMBER="$(node -e 'console.log(JSON.parse(process.argv[1]).buildNumber)' "$APPLIED")"
  echo "applied version=$TARGET_VERSION build=$BUILD_NUMBER"
else
  BUILD_NUMBER="$(python3 -c "import re;print(re.search(r'BUILD_NUMBER = ([0-9]+)',open('src/lib/version.ts').read()).group(1))")"
fi

# ── Commit + push (release only) ────────────────────────────────────────────
if [[ "$MODE" == "release" ]]; then
  step "Commit + push main"
  git add -A
  git commit -m "Release $PRODUCT $TARGET_VERSION${NOTE:+ — $NOTE}"
  git push origin main
fi

# ── Build signed app + dmg (notarize unless dry run) ────────────────────────
step "Build signed app + dmg"
[[ "$SKIP_NOTARIZE" == 1 ]] && export HM_SKIP_NOTARIZE=1

# Tauri updater signing key — needed to emit the signed auto-update artifacts
# (.app.tar.gz + .sig). Required for --release (checked earlier); optional for a
# local build (then no updater artifacts are produced).
UPDATER_KEY="$HOME/.hivematrix/tauri-updater.key"
if [[ -f "$UPDATER_KEY" && -f "$UPDATER_KEY.password" ]]; then
  TAURI_SIGNING_PRIVATE_KEY="$(cat "$UPDATER_KEY")"; export TAURI_SIGNING_PRIVATE_KEY
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$UPDATER_KEY.password")"; export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  echo "✓ updater signing key loaded"
else
  echo "… no updater signing key — building without auto-update artifacts (local build)"
fi

bash scripts/build-app.sh
bash scripts/build-dmg.sh "$TARGET_VERSION"

# ── Publish (release only) ──────────────────────────────────────────────────
if [[ "$MODE" == "release" ]]; then
  step "Publish GitHub release + $CHANNEL update feed"
  bash scripts/publish-release.sh "--$CHANNEL"
  step "Verify live $CHANNEL auto-update feed"
  npm run release:verify -- "--$CHANNEL"
fi

# ── Release metadata + artifact hashes ──────────────────────────────────────
step "Release metadata"
OUT_DIR="$OUT_ROOT/${TARGET_VERSION}-b${BUILD_NUMBER}"
BUNDLE="src-tauri/target/release/bundle"
if [[ "$SKIP_NOTARIZE" == 1 ]]; then NSTATUS="signed-not-notarized"; else NSTATUS="notarized"; fi
ART=(
  "$BUNDLE/macos/$PRODUCT.app.tar.gz"
  "$BUNDLE/macos/$PRODUCT.app.tar.gz.sig"
  "$BUNDLE/$PRODUCT.app.zip"
  "$BUNDLE/$PRODUCT-$TARGET_VERSION.dmg"
  "$BUNDLE/hivematrix-core.json"
  "$BUNDLE/hivematrix-core-beta.json"
)
META="$(HIVEMATRIX_RELEASE_CHANNEL="$CHANNEL" node scripts/write-release-metadata.mjs "$OUT_DIR" "$NSTATUS" "${ART[@]}")"
# Mirror the distributable artifacts into the output dir for a self-contained drop.
mkdir -p "$OUT_DIR"
for a in "${ART[@]}"; do [[ -f "$a" ]] && cp -f "$a" "$OUT_DIR/" || true; done
echo "✓ metadata: $META"
echo "✓ artifacts + hashes under: $OUT_DIR"

# ── Prune old build artifacts (keep last 6) ────────────────────────────────────
# build/developer-id/ accumulates ~270MB per release. Keep only the last 6 to
# avoid unbounded growth while retaining recent artifacts for debugging/rollback.
if [[ "$MODE" == "release" && -d "$OUT_ROOT" ]]; then
  step "Prune old build artifacts"
  # List directories sorted newest-first, skip the first 6 (keep), delete the rest
  dirs_to_prune="$(ls -1dt "$OUT_ROOT"/*-b[0-9]* 2>/dev/null | tail -n +7)"
  if [[ -n "$dirs_to_prune" ]]; then
    count=0
    while IFS= read -r dir; do
      if [[ -d "$dir" ]]; then
        rm -rf "$dir"
        ((count++))
      fi
    done <<< "$dirs_to_prune"
    echo "✓ pruned $count old release directories (kept last 6)"
  else
    echo "✓ no old directories to prune (≤6 releases present)"
  fi
fi

step "Done"
case "$MODE" in
  build)   echo "✓ Built $PRODUCT $TARGET_VERSION (b$BUILD_NUMBER)${SKIP_LABEL:+, un-notarized dry run}. Not published." ;;
  release) echo "✓ Released $PRODUCT $TARGET_VERSION (b$BUILD_NUMBER) on the $CHANNEL channel. Update feed is live; DMG published." ;;
esac
