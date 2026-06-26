# Browser Lane Google Auth Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [ ] Add a failing regression test in `scripts/browser-lane-app.test.mjs` that requires Google auth recovery copy, reload/external-browser actions, JavaScript popup support, and a custom user agent.
- [ ] Update `browser-lane-app/Sources/BrowserLaneApp/BrowserViewController.swift` to configure WebKit for OAuth compatibility and show a Google auth recovery panel on `accounts.google.com` flows.
- [ ] Run the focused Browser Lane app test, then build the Swift package.
- [ ] Package, sign, notarize, staple, and install `/Applications/Browser Lane.app`.
- [ ] Run HiveMatrix verification gates, commit, and push to `main`.
