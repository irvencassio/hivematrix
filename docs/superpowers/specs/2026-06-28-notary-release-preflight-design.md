# Notary Release Preflight Design

## Problem

The release process can advance into version bumping, committing, and expensive build work before discovering that Apple notarization credentials are unusable. A manual diagnostic also used the wrong Keychain lookup shape: notarytool stores saved credentials under service `com.apple.gke.notary.tool` and account `com.apple.gke.notary.tool.saved-creds.hivematrix`, while release scripts consume the profile through `xcrun notarytool ... --keychain-profile hivematrix`.

## Approach

Validate the saved notarytool profile at the start of `scripts/release.mjs`, before any version files are edited. The validation should use the same Apple ID, team ID, and profile consumed by the build scripts.

Update `scripts/setup-notary.sh` to document the actual Keychain service/account and to validate with the same Apple ID/team/profile triplet. Keep the setup script non-secret: it must never echo the app-specific password.

## Acceptance

- `scripts/release.mjs` runs `xcrun notarytool history` before the release bump.
- Notary validation pins Apple ID `cassio.irv@gmail.com`, team `8B3CHTY93V`, and profile `hivematrix`.
- `scripts/setup-notary.sh` explains the actual saved Keychain item shape.
- The notary identity test covers this behavior.
