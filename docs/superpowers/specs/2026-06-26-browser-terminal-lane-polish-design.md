# Browser Lane And Terminal Lane Polish Design

> Date: 2026-06-26 · Status: approved by operator continuation · Topic: browser-terminal-lane-polish

## Problem

Browser Lane and Terminal Lane are both real apps now, but the audit found a few
MVP edges:

- Browser Lane has a Traces sidebar item, but it still falls through to the
  generic placeholder instead of showing the daemon's trace data.
- Terminal Lane has a functional local profile path, but Add Profile is too easy
  to misconfigure and still exposes credential fields for local profiles.
- Terminal Lane hardcodes the daemon URL, while Browser Lane already has a
  Settings field for it.
- Release launch verification found both standalone apps could pass codesign,
  notarization, and Gatekeeper checks while still failing to spawn because the
  bundles carried a restricted `keychain-access-groups` entitlement without an
  embedded matching profile.

## Decision

Polish the apps without changing their trust boundaries:

1. Browser Lane gets a real trace viewer backed by `/browser-lane/traces` and
   `/browser-lane/traces/latest`.
2. Terminal Lane gets a small settings store, configurable daemon URL, and clearer
   Add Profile behavior:
   - one-click Local Mac defaults,
   - local profiles hide credential material,
   - SSH profiles show credentialRef/key material but still store only the
     credential value in macOS Keychain and send only `credentialRef` to the daemon,
   - validation prevents empty ids and missing SSH host/user.
3. Browser Lane and Terminal Lane should not request `keychain-access-groups`.
   They use normal macOS generic Keychain service/account records, which do not
   require a shared access group entitlement and launch cleanly under Developer ID.

## Scope

- Native app source under `browser-lane-app/` and `terminal-lane-app/`.
- Source-level tests under `scripts/browser-lane-app.test.mjs` and
  `scripts/terminal-lane-app.test.mjs`.
- No daemon schema changes.
- No Browser Lane cookie import from external Chrome/Safari.
- No SSH password injection into terminal sessions.
- No shared Keychain access group; these apps do not need cross-app keychain
  sharing for the MVP.

## Acceptance Criteria

- Browser Lane's `traces` route uses `TracesViewController`.
- Browser Lane daemon client can fetch traces/latest traces and display safe text.
- Terminal Lane daemon URL is user-configurable from Settings and used by the
  daemon client.
- Terminal Lane Add Profile supports Local Mac defaults and hides credential
  capture for local profiles.
- Terminal Lane Add Profile validates local/SSH inputs before save/test.
- Developer ID signed apps launch from `/Applications` without an AMFI
  `keychain-access-groups` rejection.
- Swift builds for both apps pass.
- `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`, and
  `npm run verify:portal` pass.
