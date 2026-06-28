# Notary Keychain Name Preflight Design

## Context

The HiveMatrix release lane failed before version bump because `scripts/release.mjs`
looked for the notarytool Keychain item using a `service` query:

```bash
security find-generic-password -s "com.apple.gke.notary.tool" -a "com.apple.gke.notary.tool.saved-creds.hivematrix"
```

The operator clarified the saved notarytool metadata as:

- name: `com.apple.gke.notary.tool`
- account: `com.apple.gke.notary.tool.saved-creds.hivematrix`

## Decision

Update release and setup scripts to model the Keychain metadata as `name` +
`account`, and validate it with both Keychain interpretations of "name":

```bash
security find-generic-password -s "com.apple.gke.notary.tool" -a "com.apple.gke.notary.tool.saved-creds.hivematrix" "$HOME/Library/Keychains/login.keychain-db"
security find-generic-password -l "com.apple.gke.notary.tool" -a "com.apple.gke.notary.tool.saved-creds.hivematrix" "$HOME/Library/Keychains/login.keychain-db"
```

Keep the `xcrun notarytool history --apple-id cassio.irv@gmail.com --team-id
8B3CHTY93V --keychain-profile hivematrix --keychain
~/Library/Keychains/login.keychain-db` validation as the decisive proof that the
profile is actually usable. Store credentials into that same explicit login
keychain path so setup and release never read different keychain contexts.

## Scope

- `scripts/release.mjs`
- `scripts/setup-notary.sh`
- `scripts/autodeploy-main.sh`
- `scripts/notary-identity.test.mjs`

No signing identity, Apple team, profile name, versioning, or publish behavior
changes.

## Acceptance

- Autodeploy banner says `Name` and `Account`.
- Release preflight checks both `security find-generic-password -s ... -a ...`
  and `security find-generic-password -l ... -a ...` for diagnostics.
- Setup and release both pin `~/Library/Keychains/login.keychain-db`.
- Setup script validates and reports the same lookup.
- Existing notary identity tests pass.
