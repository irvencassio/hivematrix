#!/usr/bin/env bash
#
# One-step notarization credential setup for HiveMatrix.
#
# Xcode account sign-in gives signing identities but NOT headless notarytool
# credentials. This stores an app-specific-password-based notary profile named
# "hivematrix" in the login keychain so the build pipeline can notarize with
#   xcrun notarytool submit ... --keychain-profile hivematrix
#
# Run:  bash scripts/setup-notary.sh
#
# The password is read with `read -s` (silent) and never written to disk,
# shell history, or this script — it goes straight into the keychain item.

set -euo pipefail

APPLE_ID="cassio.irv@gmail.com"
TEAM_ID="8B3CHTY93V"   # Developer ID Application: Irven Cassio
PROFILE="hivematrix"
ASP_URL="https://account.apple.com/account/manage"

echo "HiveMatrix — notarytool credential setup"
echo "========================================"
echo "Apple ID : $APPLE_ID"
echo "Team ID  : $TEAM_ID"
echo "Profile  : $PROFILE"
echo

# If a working profile already exists, don't clobber it.
if xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1; then
  echo "✓ A working '$PROFILE' notary profile already exists. Nothing to do."
  exit 0
fi

echo "Opening the App-Specific Passwords page in your browser..."
echo "  → Sign in → 'Sign-In and Security' → 'App-Specific Passwords' → '+'"
echo "  → Name it e.g. 'hivematrix-notary', then copy the xxxx-xxxx-xxxx-xxxx value."
open "$ASP_URL" 2>/dev/null || echo "  (open the URL manually: $ASP_URL)"
echo

# Read the password silently — not echoed, not stored anywhere but the keychain.
printf "Paste the app-specific password (input hidden): "
read -rs APP_PW
echo
if [ -z "${APP_PW:-}" ]; then
  echo "✗ No password entered. Aborting." >&2
  exit 1
fi

echo
echo "Storing credentials in the login keychain..."
xcrun notarytool store-credentials "$PROFILE" \
  --apple-id "$APPLE_ID" \
  --team-id "$TEAM_ID" \
  --password "$APP_PW"

# Scrub the variable from this shell.
unset APP_PW

echo
echo "Validating..."
if xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1; then
  echo "✓ Notary profile '$PROFILE' is working. Notarization is now headless:"
  echo "    xcrun notarytool submit <app.zip> --keychain-profile $PROFILE --wait"
else
  echo "✗ Stored, but validation call failed. Re-check the Apple ID / team ID / password." >&2
  exit 1
fi
