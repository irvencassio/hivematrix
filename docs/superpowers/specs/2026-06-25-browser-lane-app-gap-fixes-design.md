# Browser Lane App Gap Fixes Design

Date: 2026-06-25
Status: Approved by operator request: "fix any gaps"

## Context

The first Browser Lane Mac app task created a buildable Swift/AppKit scaffold, but live testing found three honest gaps:

- The app was a raw SwiftPM executable, not a packaged `.app`, so Computer Use could not attach to it as a normal macOS app.
- The UI only had placeholder screens. It could not open Google, enter a search, or render a web page.
- SwiftPM build output appeared as untracked `browser-lane-app/.build/` because the repo ignore rules did not cover nested Swift build folders.

## Options Considered

### Option A: Keep The Scaffold And Only Commit It

This is fastest, but it leaves the exact failures from live testing intact. It would be a paper milestone.

### Option B: Add A Native WebKit MVP And Local App Packager

This keeps the scope small while making the app testable as a real macOS artifact. The app gets a first Browser screen with an address/search field and `WKWebView`; a local package script creates `build/browser-lane/Browser Lane.app`; `.gitignore` excludes Swift build outputs.

### Option C: Move Immediately To A Full Signed Xcode App

This is the right later direction for signing, provisioning, Apple Developer setup, and login automation entitlements. It is too much for the current fix slice and would mix packaging, signing, and product behavior.

## Decision

Use Option B.

The fixed MVP should:

- Build with `swift build`.
- Package into a real `.app` bundle that macOS recognizes.
- Launch with a Browser screen.
- Let the operator type `tesla cars` and load Google search results in WebKit.
- Keep Sites, Add Site, Readiness, and Traces as placeholder maintenance screens.
- Avoid adding credential fill, login automation, or Keychain writes in this slice.
- Keep secret posture unchanged: no passwords, cookies, tokens, or Keychain values in tests or scripts.

## Non-Goals

- No CAPTCHA solving.
- No credential storage UI.
- No signed/notarized distribution build.
- No Browser Lane daemon protocol.
- No automatic login or external side effects.

## Verification

- `node --test scripts/browser-lane-app.test.mjs`
- `swift build` in `browser-lane-app`
- `node scripts/package-browser-lane-app.mjs`
- Launch packaged app and visually verify the Browser screen.
- Use UI automation or accessibility fallback to enter `tesla cars`, submit, and confirm the WebKit page loads a Google search URL.
