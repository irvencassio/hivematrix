# App Icon Choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-20-app-icon-choice-design.md`

## Task 1: Add config accessors for app icon choice

- [ ] RED: Add tests to `src/lib/models/settings-extras.test.ts`.

```ts
test("app icon choice defaults to dark-green and persists only known values", async () => {
  const s = await import(`./available.ts?case=appIcon${Date.now()}`);
  assert.equal(s.getAppIconChoice(), "dark-green");
  s.setAppIconChoice("white");
  assert.equal(s.getAppIconChoice(), "white");
  s.setAppIconChoice("dark-green");
  assert.equal(s.getAppIconChoice(), "dark-green");
});
```

- [ ] Run `npm test -- src/lib/models/settings-extras.test.ts` and confirm failure on missing exports.
- [ ] GREEN: In `src/lib/models/available.ts`, add `AppIconChoice = "dark-green" | "white"`, `getAppIconChoice()`, and `setAppIconChoice()`.
- [ ] Re-run the targeted test and confirm it passes.

## Task 2: Surface icon choice in daemon API and Settings UI

- [ ] RED: Update `src/daemon/console.test.ts` to assert:
  - Tab order is `["about", "features", "general", "models", "bees", "remote"]`.
  - `tab-general` displays `Personalization`.
  - `settingsGeneral` includes `s_app_icon`.
  - Browser script includes `saveAppIconChoice`.
- [ ] Run `npm test -- src/daemon/console.test.ts` and confirm failure.
- [ ] GREEN: Update `src/daemon/server.ts`.

```ts
// GET /models response should include:
appIconChoice: getAppIconChoice(),

// POST /settings should accept:
if (body.appIconChoice === "dark-green" || body.appIconChoice === "white") m.setAppIconChoice(body.appIconChoice);
```

- [ ] GREEN: Update `src/daemon/console.ts`.
  - Reorder tabs to About, Features, Personalization, Models, Bees, Remote.
  - Remove Projects from Settings tabs.
  - Keep the panel id `settingsGeneral` and route key `general` to limit churn.
  - Add `s_app_icon` selector in the Appearance area.
  - Populate it in `openSettings()`.
  - Add `saveAppIconChoice()` that posts `{ appIconChoice }`, reloads models, and shows a small restart hint.
- [ ] Re-run the targeted console test and confirm it passes.

## Task 3: Regenerate desktop icon assets and add white alternate

- [ ] RED: Add an asset sanity test in `scripts/icon-assets.test.mjs` that verifies:
  - `src-tauri/icons/icon.png` corner alpha is transparent.
  - Its non-transparent bounding box fills the full 512px icon.
  - `src-tauri/icons/app-icon-white.png` exists and has a white center/background with transparent corners.
- [ ] Run `npm test -- scripts/icon-assets.test.mjs` and confirm failure.
- [ ] GREEN: Update `assets/icon/icon-macos-master.svg` so its dark green artwork fills the 1024px canvas with a rounded icon silhouette and no white matte.
- [ ] GREEN: Update `assets/icon/generate.py` to:
  - Render master SVGs to PNG if the SVG is newer or the PNG is missing.
  - Generate `app-icon-dark-green.png` and `app-icon-white.png` runtime alternates.
  - Copy generated files into `src-tauri/icons/`.
- [ ] Run `assets/icon/.venv/bin/python assets/icon/generate.py`.
- [ ] Re-run the targeted asset test and confirm it passes.

## Task 4: Apply preferred Dock icon on app launch

- [ ] RED: Add Rust unit tests in `src-tauri/src/lib.rs` for parsing app icon choice from config text:
  - Missing config defaults to `DarkGreen`.
  - `"appIconChoice": "white"` resolves to `White`.
  - Unknown values resolve to `DarkGreen`.
- [ ] Run `cd src-tauri && cargo test` and confirm failure.
- [ ] GREEN: Add shell-side helpers in `src-tauri/src/lib.rs`.
  - Read `~/.hivematrix/config.json`.
  - Select bundled `icons/app-icon-dark-green.png` or `icons/app-icon-white.png`.
  - On macOS, call `NSApplication.setApplicationIconImage(...)` during setup.
  - On other platforms, safely no-op.
- [ ] Add the two runtime PNGs to `src-tauri/tauri.conf.json` bundle resources if Tauri does not already include them through the icon list.
- [ ] Re-run `cd src-tauri && cargo test`.

## Task 5: Final verification and review

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `node scripts/scope-wall.mjs`.
- [ ] Run `cd src-tauri && cargo test`.
- [ ] Review the diff for spec compliance.
- [ ] Review the diff for code quality, maintainability, and update/signing risk.
