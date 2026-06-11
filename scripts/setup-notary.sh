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

# Defensive trim: strip any whitespace/newlines that came along on paste — a
# stray leading/trailing space is the most common cause of an HTTP 400 here.
APP_PW="$(printf '%s' "$APP_PW" | tr -d '[:space:]')"

if [ -z "${APP_PW:-}" ]; then
  echo "✗ No password entered. Aborting." >&2
  exit 1
fi

# Sanity-check the format: app-specific passwords are 16 letters in 4 groups
# of 4 separated by hyphens, e.g. abcd-efgh-ijkl-mnop.
if ! printf '%s' "$APP_PW" | grep -qE '^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$'; then
  echo "⚠ Warning: that doesn't look like an app-specific password"
  echo "  (expected lowercase xxxx-xxxx-xxxx-xxxx). Continuing anyway — if this"
  echo "  400s, you likely pasted your normal Apple ID password or an API key."
  echo
fi

echo
echo "Storing credentials (verbose — full server response shown on error)..."
echo "----------------------------------------------------------------------"
# Capture verbose output so the real Apple error body is visible on 400.
set +e
STORE_OUT="$(xcrun notarytool store-credentials "$PROFILE" \
  --apple-id "$APPLE_ID" \
  --team-id "$TEAM_ID" \
  --password "$APP_PW" \
  --verbose 2>&1)"
STORE_RC=$?
set -e
unset APP_PW   # scrub from this shell regardless of outcome

# Print everything except any line that might echo the password back.
printf '%s\n' "$STORE_OUT"
echo "----------------------------------------------------------------------"

if [ $STORE_RC -ne 0 ]; then
  echo
  echo "✗ store-credentials failed (exit $STORE_RC). Diagnosing the 400..."
  echo
  echo "  Most likely causes, in order:"
  echo "   1. App-specific password wrong/expired — generate a FRESH one at"
  echo "      https://account.apple.com/account/manage and re-run this script."
  echo "      (You cannot reuse a normal Apple ID password or a revoked ASP.)"
  echo "   2. Un-accepted Apple Developer agreements — sign in at"
  echo "      https://developer.apple.com/account and accept any pending"
  echo "      license/agreement banners, then re-run."
  echo "   3. Apple ID not a member of team $TEAM_ID, or Developer Program"
  echo "      membership lapsed — check https://developer.apple.com/account"
  echo "      (Membership section). The team-id must match your Developer ID cert."
  echo
  echo "  Re-run with a fresh app-specific password:  bash scripts/setup-notary.sh"
  exit 1
fi

echo
echo "Validating..."
if xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1; then
  echo "✓ Notary profile '$PROFILE' is working. Notarization is now headless:"
  echo "    xcrun notarytool submit <app.zip> --keychain-profile $PROFILE --wait"
else
  echo "✗ Stored, but the validation call failed. Re-run with a fresh password." >&2
  exit 1
fi
