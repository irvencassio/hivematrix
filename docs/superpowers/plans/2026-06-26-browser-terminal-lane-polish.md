# Browser Lane And Terminal Lane Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-26-browser-terminal-lane-polish-design.md`.

## Task 1 — RED: app source tests

- [x] Extend `scripts/browser-lane-app.test.mjs` to require a real
      `TracesViewController`, `ContentViewController` route wiring, and daemon
      methods for `/browser-lane/traces` and `/browser-lane/traces/latest`.
- [x] Extend `scripts/terminal-lane-app.test.mjs` to require
      `TerminalLaneSettings`, configurable daemon URL usage, Local Mac defaults,
      `kindChanged`, local credential hiding, and SSH validation copy.

## Task 2 — GREEN: Browser Lane traces

- [x] Add `browser-lane-app/Sources/BrowserLaneApp/TracesViewController.swift`.
- [x] Add `BrowserLaneDaemonClient.fetchTraces` and `fetchLatestTrace`.
- [x] Route `.traces` to the new controller.
- [x] Keep rendering raw JSON/text secret-safe by relying on the daemon redaction.

## Task 3 — GREEN: Terminal Lane settings and Add Profile polish

- [x] Add `terminal-lane-app/Sources/TerminalLaneApp/TerminalLaneSettings.swift`.
- [x] Make `TerminalLaneDaemonClient` read `TerminalLaneSettings.shared.daemonURL`.
- [x] Rebuild `SettingsViewController` with editable daemon URL plus storage/about.
- [x] Update `AddProfileViewController` with Local Mac defaults, kind-based field
      visibility, validation, and clearer status messages.

## Task 4 — Verify

- [x] `swift build` in `browser-lane-app`.
- [x] `swift build` in `terminal-lane-app`.
- [x] `npm run typecheck`.
- [x] `npm test`.
- [x] `node scripts/scope-wall.mjs`.
- [x] `npm run verify:portal`.
- [x] Commit and push to `main`.

## Task 5 — Release launch fix

- [x] RED: update Browser Lane and Terminal Lane app tests to reject restricted
      `keychain-access-groups` entitlements for Developer ID standalone apps.
- [x] GREEN: remove `keychain-access-groups` from both standalone app
      entitlement files while keeping sandbox off.
- [x] Repackage, Developer ID sign, notarize, staple, install, and launch-test
      both apps from `/Applications`.
