# Pre-release Operator-Path Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-26-prerelease-operator-path-hardening-design.md`

## Task 1 — RED: Edit menu tests

- [ ] Extend `scripts/browser-lane-app.test.mjs` + `scripts/terminal-lane-app.test.mjs`:
  each AppDelegate installs an Edit menu — assert `NSMenu`, `cut:`, `copy:`,
  `paste:`, `selectAll:`, and an `installMainMenu`/`mainMenu` setup.
- [ ] Run → fail.

## Task 2 — GREEN: Edit menu in both AppDelegates

- [ ] Add `installMainMenu()` to `browser-lane-app/.../AppDelegate.swift` and
  `terminal-lane-app/.../AppDelegate.swift`, called from
  `applicationDidFinishLaunching`. App menu (Quit ⌘Q) + Edit menu
  (Undo/Redo/Cut/Copy/Paste/Select All) wired to first-responder selectors.

## Task 3 — RED: Add Site overhaul tests

- [ ] Extend `scripts/browser-lane-app.test.mjs`:
  - Advanced disclosure hides Site id + Credential ref (`Advanced`, toggling rows).
  - Auto-generate site id from name (`slug`/`autoSiteId`) + credentialRef
    (`hivematrix.browser.` built from id).
  - Editing support: `BrowserLaneEditTarget`, prefill, preserve secret on blank
    password (`leave blank to keep`/no overwrite), focus offending field
    (`makeFirstResponder`).
  - Sites screen has an Edit affordance (`editSite`/"Edit").
  - Daemon payload still carries no `password`.
- [ ] Run → fail.

## Task 4 — GREEN: Add Site + Sites Swift

- [ ] `BrowserLaneModels.swift`: add `BrowserLaneEditTarget` + a navigate Notification.
- [ ] `AddSiteViewController.swift`: Advanced disclosure; auto-gen id + credentialRef;
  load edit target + prefill; preserve secret on blank password; field-specific
  errors (focus + red). Keep daemon payload metadata-only.
- [ ] `SitesViewController.swift`: per-site Edit button → set edit target + post navigate.
- [ ] `ContentViewController.swift`: observe the navigate notification → show addSite.

## Task 5 — RED→GREEN: video approval regression

- [ ] New `src/lib/video/approval-no-render.test.ts`: assert `news-review.ts`
  approval path imports/uses `createHeyGenPortalTaskForDraft` and contains no
  `make-avatar`/`heygen` API render call; a behavioral run with stubbed deps
  approves via portal and never calls a renderer. Run → (fail if guard missing) → green.

## Task 6 — RED→GREEN: release smoke

- [ ] `scripts/release-smoke.mjs` — runnable checklist (temp DB) per design.
- [ ] `scripts/release-smoke.test.mjs` — runs the checks, asserts pass + no secrets.
- [ ] Run → green.

## Task 7 — Rebuild + gates

- [ ] `node scripts/package-browser-lane-app.mjs`, `node scripts/package-terminal-lane-app.mjs`.
- [ ] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.

## Task 8 — Commit & push to main

- [ ] Commit; push; report hash + rebuild status.
