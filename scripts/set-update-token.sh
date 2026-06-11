#!/usr/bin/env bash
#
# Install + validate the update-channel access token (fine-grained PAT).
#
#   bash scripts/set-update-token.sh <token>
#   bash scripts/set-update-token.sh            # reads the token from stdin (hidden)
#
# GitHub does NOT allow minting fine-grained PATs via API/gh — create one in the
# web UI first:
#   github.com ▸ Settings ▸ Developer settings ▸ Personal access tokens ▸
#   Fine-grained tokens ▸ Generate new token
#     • Resource owner: your account
#     • Repository access: Only select repositories → irvencassio/hivematrix
#     • Permissions ▸ Repository ▸ Contents: Read-only   (nothing else)
#     • Expiration: set a reminder to rotate before it lapses
#
# This script validates the token can read the v0.1.0 release manifest asset,
# then writes it to ~/.hivematrix/keys/github-token (mode 600). Replaces the
# broad `gh` CLI token used for the initial demo.

set -euo pipefail

REPO="irvencassio/hivematrix"
DEST="$HOME/.hivematrix/keys/github-token"

TOKEN="${1:-}"
if [ -z "$TOKEN" ]; then
  printf "Paste the fine-grained PAT (hidden): "
  read -rs TOKEN; echo
fi
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
[ -n "$TOKEN" ] || { echo "✗ no token provided" >&2; exit 1; }

echo "==> Validating the token can read $REPO release assets…"
# List release assets via the API (Contents:Read is sufficient).
code=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/releases/latest")
if [ "$code" != "200" ]; then
  echo "✗ token could not read $REPO releases (HTTP $code). Check repo access + Contents:Read." >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
printf '%s' "$TOKEN" > "$DEST"
chmod 600 "$DEST"
echo "✓ token installed at $DEST (mode 600), validated against $REPO."
echo "  config.updater.authTokenPath should point here; restart the daemon to pick it up."
