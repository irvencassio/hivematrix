# Terminal Lane macOS App Runbook

Terminal Lane is the native macOS surface for maintaining shell profiles and opening persistent local or SSH sessions. Secrets are stored in macOS Keychain only; HiveMatrix stores profile metadata and an auto-derived `credentialRef` marker (`hivematrix.terminal.<profileId>`).

SSH passwords are Keychain **Internet Password** items keyed by host + user + port + protocol — the same identity other SSH tools on this Mac use, so an item already saved for `user@host` is found and reused; nothing needs to be re-entered. Items are written with a permissive ACL (SPM builds change binary hash every rebuild, and the daemon reads the same items), and remain protected by the Keychain unlock.

## Build And Install

```bash
node scripts/generate-terminal-lane-icon.mjs
node scripts/package-terminal-lane-app.mjs
ditto "build/terminal-lane/Terminal Lane.app" "/Applications/Terminal Lane.app"
```

Sign/notarize with the Irv Cassio Developer ID identity and the `hivematrix` notary profile:

```bash
codesign --force --sign "Developer ID Application: Irven Cassio (8B3CHTY93V)" --options runtime --timestamp --entitlements /tmp/terminal-lane-entitlements.plist "/Applications/Terminal Lane.app"
xcrun notarytool submit /tmp/Terminal-Lane-notarize.zip --apple-id cassio.irv@gmail.com --team-id 8B3CHTY93V --keychain-profile hivematrix --wait
xcrun stapler staple "/Applications/Terminal Lane.app"
spctl --assess --type execute --verbose=4 "/Applications/Terminal Lane.app"
```

## Daily Use

1. Open Terminal Lane.
2. Add a local or SSH profile.
3. Store any auth material through the app so it goes to Keychain, not SQLite.
4. Sync the profile to HiveMatrix.
5. Run readiness from the app or daemon.
6. Open the profile from the Terminal screen. The SwiftTerm PTY stays live for the app lifetime.

## Daemon Endpoints

- `GET /terminal-lane/profiles`
- `POST /terminal-lane/profiles`
- `GET /terminal-lane/dashboard`
- `POST /terminal-lane/probes`
- `POST /terminal-lane/readiness/run`
- `GET /terminal-lane/traces`

All non-public daemon routes require the local HiveMatrix auth token.
