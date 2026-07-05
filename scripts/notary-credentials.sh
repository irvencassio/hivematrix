#!/usr/bin/env bash
#
# Sourceable notary-credential resolver, shared by developer-id-release.sh,
# build-app.sh, and build-dmg.sh so the credential mechanism is chosen (and
# printed) in exactly one place. Prefer `xcrun notarytool`.
#
#   source "$(dirname "$0")/notary-credentials.sh"; resolve_notary_args
#   xcrun notarytool submit "$T" "${NOTARY_ARGS[@]}" --wait
#
# After resolve_notary_args:
#   NOTARY_ARGS       bash array of notarytool flags (secrets included for exec)
#   NOTARY_MECHANISM  human-readable mechanism string — NEVER a secret value
#
# Resolution order (documented, deterministic):
#   1. NOTARYTOOL_KEYCHAIN_PROFILE           (env override)
#   2. default keychain profile "hivematrix" (scripts/setup-notary.sh)
#   3. APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD (+ APPLE_TEAM_ID, default 8B3CHTY93V)
#   else -> NOTARY_MECHANISM="none" (caller decides whether that's fatal)

NOTARY_TEAM_ID="${APPLE_TEAM_ID:-8B3CHTY93V}"
NOTARY_APPLE_ID_DEFAULT="cassio.irv@gmail.com"
NOTARY_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
NOTARY_DEFAULT_PROFILE="hivematrix"
NOTARY_KEYCHAIN_SERVICE="com.apple.gke.notary.tool"
NOTARY_KEYCHAIN_ACCOUNT="com.apple.gke.notary.tool.saved-creds.${NOTARY_DEFAULT_PROFILE}"

_have_default_notary_profile() {
  security find-generic-password -s "$NOTARY_KEYCHAIN_SERVICE" -a "$NOTARY_KEYCHAIN_ACCOUNT" "$NOTARY_KEYCHAIN" >/dev/null 2>&1 \
    || security find-generic-password -l "$NOTARY_KEYCHAIN_SERVICE" -a "$NOTARY_KEYCHAIN_ACCOUNT" "$NOTARY_KEYCHAIN" >/dev/null 2>&1
}

resolve_notary_args() {
  NOTARY_ARGS=()
  if [[ -n "${NOTARYTOOL_KEYCHAIN_PROFILE:-}" ]]; then
    NOTARY_ARGS=(--keychain-profile "$NOTARYTOOL_KEYCHAIN_PROFILE" --keychain "$NOTARY_KEYCHAIN")
    NOTARY_MECHANISM="keychain-profile:${NOTARYTOOL_KEYCHAIN_PROFILE} (via NOTARYTOOL_KEYCHAIN_PROFILE)"
  elif _have_default_notary_profile; then
    NOTARY_ARGS=(--apple-id "$NOTARY_APPLE_ID_DEFAULT" --team-id "$NOTARY_TEAM_ID" --keychain-profile "$NOTARY_DEFAULT_PROFILE" --keychain "$NOTARY_KEYCHAIN")
    NOTARY_MECHANISM="keychain-profile:${NOTARY_DEFAULT_PROFILE} (default)"
  elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then
    NOTARY_ARGS=(--apple-id "$APPLE_ID" --team-id "$NOTARY_TEAM_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD")
    NOTARY_MECHANISM="apple-id:${APPLE_ID} team:${NOTARY_TEAM_ID} (app-specific-password via APPLE_APP_SPECIFIC_PASSWORD env)"
  else
    NOTARY_MECHANISM="none"
  fi
}
