# Browser Lane App Gap Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

## Goal

Repair the gaps found by live Computer Use testing of the Browser Lane Mac app: package it as a normal `.app`, add a minimal WebKit search/browser screen, and keep generated SwiftPM output out of git.

## Task 1: Add Failing Smoke Coverage

- [x] Update `scripts/browser-lane-app.test.mjs`.
- [x] Assert nested Swift `.build/` output is ignored.
- [x] Assert the app contains a `WKWebView` browser surface.
- [x] Assert the app has a search/address field and a deterministic Google search URL builder.
- [x] Assert `scripts/package-browser-lane-app.mjs` exists and references `Browser Lane.app`, `Info.plist`, and the `BrowserLane` executable.
- [x] Run `node --test scripts/browser-lane-app.test.mjs` and confirm RED.

## Task 2: Implement Browser/Search Screen

- [x] Add `browser-lane-app/Sources/BrowserLaneApp/BrowserViewController.swift`.
- [x] Add `BrowserURLBuilder` with deterministic `url(for:)` behavior:
  - `http://` and `https://` inputs load directly.
  - bare domains become `https://domain`.
  - other text becomes `https://www.google.com/search?q=<encoded query>`.
- [x] Add a Browser screen to `Screens.swift` and make it the first/default screen.
- [x] Update `ContentViewController.swift` to show `BrowserViewController` for `.browser`.
- [x] Keep the existing maintenance placeholders for Sites, Add Site, Readiness, and Traces.
- [x] Run the smoke test and `swift build`.

## Task 3: Add Local `.app` Packager And Ignore Build Output

- [x] Add `scripts/package-browser-lane-app.mjs`.
- [x] Script runs `swift build`, creates `build/browser-lane/Browser Lane.app`, copies `Resources/Info.plist`, creates `Contents/MacOS`, copies `.build/debug/BrowserLane`, and copies entitlements metadata into `Contents/Resources`.
- [x] Add `**/.build/` to `.gitignore`.
- [x] Run `node scripts/package-browser-lane-app.mjs`.
- [x] Launch `build/browser-lane/Browser Lane.app`.

## Task 4: Live UI Verification

- [x] Use Computer Use first; if the app is not attachable, use macOS accessibility fallback.
- [x] Confirm the packaged app appears as Browser Lane / bundle identifier `com.irvcassio.hivematrix.browserlane`.
- [x] Type `tesla cars` in the Browser screen, submit, and confirm a Google search result page loads.
- [x] Run repo gates that are reasonable for this slice: smoke test, Swift build, package script, and optionally full `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs` if time permits.
