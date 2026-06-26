# Browser Lane Google Popup Opener Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [ ] Add a failing static regression test in `scripts/browser-lane-app.test.mjs` that requires a real `popupWebView`, `webViewDidClose`, and no main-view `webView.load(navigationAction.request)` inside `createWebViewWith`.
- [ ] Update `browser-lane-app/Sources/BrowserLaneApp/BrowserViewController.swift` with an in-app popup overlay and returned child WKWebView.
- [ ] Run `node --test scripts/browser-lane-app.test.mjs` and `swift build -c release` in `browser-lane-app`.
- [ ] Package, copy to `/Applications`, sign, notarize, staple, and Gatekeeper-assess Browser Lane.
- [ ] Re-test HeyGen Google SSO manually with Computer Use.
- [ ] Commit and push only the Browser Lane changes to `main`.
