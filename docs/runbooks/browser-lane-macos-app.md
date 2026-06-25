# Browser Lane macOS App Runbook

Browser Lane starts as a separate native macOS app so authentication readiness can be tested before the full HiveMatrix UI depends on it.

## Identity

- App name: Browser Lane
- Bundle identifier: `com.irvcassio.hivematrix.browserlane`
- Apple team: Team Irv Cassio (`cassio.irv@gmail.com`)
- Keychain service: `HiveMatrix Browser Lane`
- Credential refs: `hivematrix.browser.<site>.<account>`

## Operator Setup

1. Launch the Browser Lane app.
2. Add a site with display name, home URL, login URL, allowed domains, and a credential ref.
3. Save the username and password through the native app so the secret lands in macOS Keychain.
4. Run daily readiness. Green means the saved browser session is ready; orange means human auth is required; yellow means page assertions failed; red means blocked.

## Provisioning

Create the App ID and provisioning profile for `com.irvcassio.hivematrix.browserlane` in the Apple Developer portal under Team Irv Cassio. Stop for password or two-factor prompts; do not store Apple credentials in HiveMatrix.

### Portal Status - 2026-06-25

- App ID created: `Browser Lane`
- Bundle ID: `com.irvcassio.hivematrix.browserlane`
- Team ID: `8B3CHTY93V`
- Developer ID provisioning profile created: `Browser Lane Developer ID`
- Profile type: macOS `Developer ID Application`
- Profile ID: `2X9KP8432Q`
- Profile expiration: `2031/05/06`
- Certificate included: `Irven Cassio (Developer ID Application)`, expiring `2031/05/06`
- Download note: Chrome reached Apple's `downloadProfileContent` URL but blocked the page with `ERR_BLOCKED_BY_CLIENT`; no new `.provisionprofile` file was observed in `~/Downloads`. Re-download from Apple Developer Profiles if the local build/sign lane needs the profile file.

## Build Sketch

```bash
cd browser-lane-app
swift build -c release
```

Packaging into a `.app` bundle should copy `Resources/Info.plist`, apply `Resources/entitlements.plist`, sign with the Irv Cassio Developer ID Application certificate, and notarize before distribution.
