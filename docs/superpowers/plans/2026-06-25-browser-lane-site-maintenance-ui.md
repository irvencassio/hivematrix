# Browser Lane Site Maintenance UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Tasks

- [ ] Add RED static tests for the native Add Site implementation.
  - File: `scripts/browser-lane-app.test.mjs`
  - Assert `AddSiteViewController.swift`, `BrowserLaneSiteStore.swift`, `BrowserLaneKeychain.swift`, and `BrowserLaneDaemonClient.swift` exist.
  - Assert Add Site uses text fields, `NSSecureTextField`, and a save action.
  - Assert Keychain code imports `Security` and uses `SecItemAdd` / `SecItemUpdate`.
  - Assert the site metadata model does not declare password/token/cookie/secret fields.

- [ ] Implement metadata and Keychain support.
  - Add `BrowserLaneModels.swift`.
  - Add `BrowserLaneSiteStore.swift` storing metadata JSON under Application Support.
  - Add `BrowserLaneKeychain.swift` using `Security.framework` with service `HiveMatrix Browser Lane`.
  - Add `BrowserLaneDaemonClient.swift` to sync metadata to `http://127.0.0.1:3747/browser-lane/sites` with `~/.hivematrix/auth-token`.

- [ ] Implement native screens.
  - Add `AddSiteViewController.swift` with the maintenance form.
  - Add `SitesViewController.swift` showing saved site metadata and credential refs.
  - Update `ContentViewController.swift` to route `.sites` and `.addSite` to real controllers.
  - Update placeholder copy in `Screens.swift` so it does not claim Add Site is unwired.

- [ ] Verify and ship locally.
  - `node --test scripts/browser-lane-app.test.mjs`
  - `swift build` in `browser-lane-app`
  - `node scripts/package-browser-lane-app.mjs`
  - Copy to `/Applications/Browser Lane.app`
  - Sign with Developer ID Application: Irven Cassio (8B3CHTY93V)
  - Notarize, staple, Gatekeeper assess
  - Launch with Computer Use and verify Add Site shows a real form.
