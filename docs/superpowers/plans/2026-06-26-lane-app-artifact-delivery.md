# Lane App Artifact Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-26-lane-app-artifact-delivery-design.md`

## Task 1 — RED: delivery tests

- [x] Add lane app artifact path tests in `src/lib/lane-apps/index.test.ts`.
- [x] Add source tests proving Tauri resources include both lane apps.
- [x] Add source tests proving `scripts/build-app.sh` packages/signs both lane app bundles.

## Task 2 — GREEN: artifact lookup

- [x] Replace `import.meta.url` artifact lookup with packaged-resource + dev-checkout candidates.
- [x] Export injectable artifact path helpers for tests.
- [x] Preserve pinned expected fallback when artifacts are absent.

## Task 3 — GREEN: bundle lane artifacts in releases

- [x] Add lane app resources to `src-tauri/tauri.conf.json`.
- [x] Build Browser Lane and Terminal Lane before Tauri packaging in `scripts/build-app.sh`.
- [x] Sign both lane app bundles before Tauri copies resources.

## Task 4 — Verify and ship

- [x] `node scripts/package-browser-lane-app.mjs`
- [x] `node scripts/package-terminal-lane-app.mjs`
- [x] Focused tests.
- [x] `npm run typecheck`.
- [x] `npm test`.
- [x] `node scripts/scope-wall.mjs`.
- [x] `npm run verify:portal`.
- [ ] Commit and push to `main`.
- [ ] Release a new HiveMatrix desktop version.
