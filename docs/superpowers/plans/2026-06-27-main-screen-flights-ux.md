# Main-Screen Flights UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-06-27-main-screen-flights-ux-design.md`

## Task 1 - RED: Store edit/delete tests

Files:

- `src/lib/work-packages/store.test.ts`
- `src/lib/work-packages/store.ts`

Steps:

- [ ] Add a failing test that `updateWorkPackageItem` persists edited `title` and `prompt`.
- [ ] Add a failing test that edited item title/prompt redact secret-looking values.
- [ ] Add a failing test that `deleteWorkPackage` deletes package and items.
- [ ] Add a failing test that `deleteWorkPackage` refuses a package with a `running` item.
- [ ] Run `node --import tsx/esm --test src/lib/work-packages/store.test.ts` and confirm failure is for missing behavior only.

Expected implementation:

- Export `deleteWorkPackage(id)`.
- Add `title` and `prompt` to safe item patch fields.
- Redact `title`, `prompt`, and `blocker` string patches.
- Delete item rows before package row inside a transaction.

## Task 2 - GREEN: Store edit/delete implementation

Files:

- `src/lib/work-packages/store.ts`

Steps:

- [ ] Implement item title/prompt patch support.
- [ ] Implement conservative package deletion.
- [ ] Re-run `node --import tsx/esm --test src/lib/work-packages/store.test.ts`.

## Task 3 - RED: Server route and console source tests

Files:

- `src/daemon/server.test.ts`
- `src/daemon/server.ts`
- `src/daemon/console.ts`

Steps:

- [ ] Add a failing server test for `DELETE /work-packages/:id` success.
- [ ] Add a failing server test for `DELETE /work-packages/:id` returning 409 while a package item is running.
- [ ] Add console source assertions for visible Flights main rail/detail identifiers.
- [ ] Add console source assertions that the new-task route/toast uses Flight language and no longer tells the operator to open Settings -> Lanes -> Work Packages.
- [ ] Run `node --import tsx/esm --test src/daemon/server.test.ts --test-name-pattern "work package|Flights|Flight|DELETE"` and confirm failure is for missing behavior only.

Expected implementation:

- Add `DELETE /work-packages/:id`.
- Keep existing `/work-packages` path for compatibility.
- Broadcast `work-packages:updated` after successful delete.

## Task 4 - GREEN: Server route

Files:

- `src/daemon/server.ts`

Steps:

- [ ] Wire `deleteWorkPackage`.
- [ ] Return 404 for missing package.
- [ ] Return 409 with a human-readable reason for running packages.
- [ ] Re-run focused server tests.

## Task 5 - GREEN: Main-screen Flights UI

Files:

- `src/daemon/console.ts`

Steps:

- [ ] Add state for `workPackages` and `selectedFlight`.
- [ ] Load packages during `refresh()` without breaking existing task refresh.
- [ ] Add a main-board `Flights` section below the New task button.
- [ ] Add `renderFlightsRail()`, `selectFlight()`, and `renderFlightDetail()`.
- [ ] Update Overview to include Flight counts.
- [ ] Update New Task route copy and toast to Flight language.
- [ ] Add edit/delete actions for package and item text.
- [ ] Keep Settings panel rendering available, but rename visible labels to Flights where operator-facing.
- [ ] Re-run focused server tests.

## Task 6 - Verification and release

Files:

- all touched files

Steps:

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `node scripts/scope-wall.mjs`.
- [ ] Inspect `git diff` to ensure previous package changes are preserved.
- [ ] Commit all intended HiveMatrix changes on `main`.
- [ ] Push `main`.
- [ ] Run the full HiveMatrix desktop auto-update release lane for this repo.
- [ ] Prove the live auto-update feed points at the pushed commit.
