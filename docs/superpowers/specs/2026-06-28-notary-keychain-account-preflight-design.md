# Notary Keychain Account Preflight Design

## Problem

The HiveMatrix release lane failed before version bump because `xcrun notarytool history --keychain-profile hivematrix` could not find a usable saved profile. The actual saved Keychain shape for Apple's notarytool is not just a profile name; it is:

- service/name: `com.apple.gke.notary.tool`
- account: `com.apple.gke.notary.tool.saved-creds.hivematrix`

The scripts already document this in places, but the automated preflight does not check the exact Keychain service/account before asking `notarytool` to use the profile. That leaves the operator with a vague "profile not usable" error.

## Approach

Keep `hivematrix` as the notarytool profile name. Add explicit constants for the Keychain service/account in `scripts/release.mjs`, and make the preflight do two checks before editing version files:

1. `security find-generic-password -s com.apple.gke.notary.tool -a com.apple.gke.notary.tool.saved-creds.hivematrix`
2. `xcrun notarytool history --apple-id cassio.irv@gmail.com --team-id 8B3CHTY93V --keychain-profile hivematrix`

Update `scripts/setup-notary.sh` to print the same lookup command and verify the exact service/account after storing credentials. Update `scripts/autodeploy-main.sh` to print the Keychain service/account alongside the release source-of-truth files.

## Acceptance

- The release preflight checks the exact Keychain service/account before version files are edited.
- Failure output includes the exact `security find-generic-password` command and `notarytool` command.
- Setup script validates the exact saved account after storing credentials.
- Autodeploy banner tells the operator the profile, service, and account.
- Focused tests cover the profile/account wiring.
- Required gates pass.
