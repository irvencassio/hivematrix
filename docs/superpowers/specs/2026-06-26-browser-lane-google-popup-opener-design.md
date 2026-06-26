# Browser Lane Google Popup Opener Design

## Context

HeyGen's Google SSO reaches `accounts.google.com/gsi/transform` and then renders a blank page inside Browser Lane. The prior Browser Lane popup handling loaded `target="_blank"` and OAuth popup requests into the main WKWebView. That is not enough for Google Identity Services popup mode: after account selection, Google's transform page expects a real popup/opener relationship so it can communicate the result back to the HeyGen login page.

## Goals

- Keep Google SSO popups as real WKWebView popup windows.
- Preserve the shared persistent website data store.
- Preserve the Google auth recovery strip for blank/stalled auth pages.
- Avoid reading or storing passwords, tokens, cookies, or Keychain values.

## Design

Browser Lane will display popup navigation requests in an in-app overlay containing a child WKWebView created from WebKit's supplied popup configuration. The child web view is returned from `WKUIDelegate.createWebViewWith`, so WebKit preserves the opener relationship Google relies on.

The main browser view will no longer load popup requests directly. The overlay will include a close button and status label. `webViewDidClose` will remove the popup when the page calls `window.close()`.

This should let Google GSI complete the popup handoff back to HeyGen. If Google still blocks the embedded flow, the existing Chrome/Safari recovery buttons remain visible and honest.

## Verification

- Add a static Browser Lane test proving popups use a returned `popupWebView`, not `webView.load(navigationAction.request)`.
- Build the Browser Lane Swift package.
- Package, sign, notarize, staple, and install `/Applications/Browser Lane.app`.
- Exercise the HeyGen Google SSO path with Computer Use.
