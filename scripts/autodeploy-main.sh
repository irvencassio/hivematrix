#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

tmp_node_red="$(mktemp -t hivematrix-node-red.XXXXXX)"
cleanup() {
  rm -f "$tmp_node_red"
}
trap cleanup EXIT

echo "HiveMatrix one-command autodeploy"
echo
echo "This wrapper delegates the actual release work to scripts/release.mjs."
echo "scripts/release.mjs owns: version file updates, git add/commit/push,"
echo "typecheck/tests/scope-wall, signed/notarized app and DMG builds,"
echo "GitHub release/feed publishing, and live auto-update verification."
echo
echo "Release/notary source-of-truth files:"
echo "  scripts/release.mjs              - release lane, version bump, commit, push, build, publish, verify"
echo "  scripts/build-app.sh             - signed/notarized .app and updater archive"
echo "  scripts/build-dmg.sh             - signed/notarized DMG"
echo "  scripts/setup-notary.sh          - notarytool credential setup and validation"
echo "  scripts/notary-identity.test.mjs - source guard for Apple ID/team/profile wiring"
echo
echo "Notary profile/keychain:"
echo "  Profile : hivematrix"
echo "  Service : com.apple.gke.notary.tool"
echo "  Account : com.apple.gke.notary.tool.saved-creds.hivematrix"
echo
echo "Node-RED logic check:"
if rg -n "node-red|nodered|Node-RED" src scripts package.json \
  --glob '!scripts/autodeploy-main.sh' \
  --glob '!scripts/autodeploy-main.test.mjs' \
  >"$tmp_node_red" 2>/dev/null; then
  cat "$tmp_node_red"
else
  echo "  No Node-RED logic found in HiveMatrix source."
  echo "  If you meant notary/release profile logic, use the files listed above."
fi
echo

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" != "main" ]]; then
  echo "Refusing to autodeploy from branch '$branch'. Switch to main first." >&2
  exit 1
fi

echo "Fetching origin/main..."
git fetch origin main

echo
echo "Current git state:"
git status --short --branch
echo

if [[ "${1:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  VERSION="$1"
  shift
else
  NEXT_VERSION="$(
    node -e '
      const { readFileSync } = require("node:fs");
      const version = JSON.parse(readFileSync("package.json", "utf8")).version;
      const parts = version.split(".").map(Number);
      if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
        throw new Error(`package.json version is not x.y.z: ${version}`);
      }
      parts[2] += 1;
      console.log(parts.join("."));
    '
  )"
  VERSION="$NEXT_VERSION"
fi

NOTE="${*:-auto-deploy HiveMatrix}"

echo "Autodeploy target version: $VERSION"
echo "Autodeploy note: $NOTE"
echo
echo "Running: node scripts/release.mjs \"$VERSION\" \"$NOTE\""
node scripts/release.mjs "$VERSION" "$NOTE"
