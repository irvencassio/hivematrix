# Browser Lane App Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Tasks

- [ ] Add RED tests for Browser Lane icon and Settings wiring.
  - Update `scripts/browser-lane-app.test.mjs`.
  - Assert `browser-lane-app/Resources/BrowserLane.icns` exists.
  - Assert `browser-lane-app/Resources/BrowserLaneWhite.icns` exists.
  - Assert `browser-lane-app/Resources/browser-lane-icon.svg` exists and uses the HiveMatrix green/dark palette.
  - Assert both generated PNG previews have transparent corners.
  - Assert `Info.plist` has `CFBundleIconFile`.
  - Assert `scripts/package-browser-lane-app.mjs` copies both icon states.
  - Assert Settings is in the sidebar and has icon, browser default URL, daemon, storage, and About/version sections.

- [ ] Add deterministic icon assets.
  - Add `browser-lane-app/Resources/browser-lane-icon.svg`.
  - Add `browser-lane-app/Resources/browser-lane-icon-white.svg`.
  - Add a small generator `scripts/generate-browser-lane-icon.mjs` or Python helper that renders the SVG into iconset PNGs and `BrowserLane.icns`.
  - Generate `browser-lane-app/Resources/BrowserLane.icns` and `BrowserLaneWhite.icns`.

- [ ] Wire the bundle.
  - Update `browser-lane-app/Resources/Info.plist`.
  - Update `scripts/package-browser-lane-app.mjs` to copy `.icns` into `Contents/Resources`.

- [ ] Add native Settings.
  - Add `.settings` to `Screen`.
  - Add `BrowserLaneSettings.swift` for persisted app preferences.
  - Add `SettingsViewController.swift` with:
    - icon state segmented control/dropdown
    - default/start URL field
    - daemon URL/token path metadata
    - local site metadata path and Keychain service
    - About/version bundle info
  - Apply selected icon state at runtime using `NSApplication.shared.applicationIconImage`.

- [ ] Verify.
  - `node --test scripts/browser-lane-app.test.mjs`
  - `swift build` in `browser-lane-app`
  - `node scripts/package-browser-lane-app.mjs`
  - Install to `/Applications/Browser Lane.app`
  - Developer ID sign with hardened runtime
  - Notarize with `notarytool` profile `hivematrix`
  - Staple and `spctl` verify
  - Launch with Computer Use and check the bundle metadata.
