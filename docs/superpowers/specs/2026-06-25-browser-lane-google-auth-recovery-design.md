# Browser Lane Google Auth Recovery Design

## Context

Google SSO can leave Browser Lane's embedded WKWebView on a blank white page after password entry. The app currently has a persistent WebKit data store and popup handling, but it does not surface any recovery action when an OAuth provider blocks or stalls the embedded flow.

## Goals

- Keep Browser Lane honest: do not claim Google auth succeeded when the embedded page is blank.
- Make Google auth pages visibly recoverable with operator actions.
- Preserve the existing persistent WKWebView session posture and OAuth popup handling.
- Avoid credential exposure. Browser Lane must not read or log passwords, cookies, tokens, or Keychain values.

## Design

Browser Lane will detect Google auth hosts and show a compact recovery panel above the WebKit view. The panel explains that Google sign-in can block embedded browser flows and provides three explicit actions:

- Reload auth
- Open in Chrome
- Open in Safari

The WebKit configuration will also enable JavaScript popup windows and use a normal Safari user agent. This improves compatibility but does not promise that every Google SSO flow will complete inside WKWebView.

External-browser actions are intentionally framed as recovery/handoff actions. They are useful for operator diagnosis and normal browser sign-in, but they do not secretly copy cookies into Browser Lane.

## Verification

- Static Browser Lane regression test must fail before the fix and pass after.
- Browser Lane Swift package must build.
- Full HiveMatrix gates should pass before commit:
  - `npm run typecheck`
  - `npm test`
  - `node scripts/scope-wall.mjs`
