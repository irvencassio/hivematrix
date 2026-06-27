# Work Package Ready-Item Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-27-work-package-orchestration-design.md`.
TDD throughout. Gates: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.

---

## Task 1 — Planner + orchestration core (RED → GREEN)

- [ ] Write `src/lib/work-packages/orchestrate.test.ts`: planNextItems eligibility
      (ready+deps; dep-not-done blocked; held never eligible; writer concurrency 1;
      worktree/safe parallel; external active task blocks a writer);
      startWorkPackage (draft→ready not held, first writer only, package running);
      advance after a child done (dependent starts; package done when all done);
      tickWorkPackages advances a running package.
- [ ] Run, watch fail.
- [ ] Implement `src/lib/work-packages/orchestrate.ts`:
  - `planNextItems(detail, activeSameProject)` — pure.
  - `reconcileWorkPackage(id)`.
  - `advanceWorkPackage(id)`.
  - `startWorkPackage(id)`.
  - `tickWorkPackages(deps?)`.
  - `startWorkPackageOrchestrationLoop(intervalMs)` / stop — mirror
    `startBrowserLaneReadinessLoop`.
- [ ] Watch pass.

## Task 2 — Store: findItemByTaskId (RED → GREEN)

- [ ] Add a test in `src/lib/work-packages/store.test.ts`: `findItemByTaskId`
      returns `{ packageId, itemId }` after `createTaskFromItem`, null otherwise.
- [ ] Run, watch fail.
- [ ] Implement `findItemByTaskId` in `store.ts`.
- [ ] Watch pass.

## Task 3 — APIs + event hook (RED → GREEN)

- [ ] Add server tests: POST `/work-packages/:id/start` → package running + first
      item has a task; PATCH that task to `done` → next item auto-gets a task
      (event hook); a held release item is never auto-started.
- [ ] Run, watch fail.
- [ ] Add `POST /work-packages/:id/start` + `POST /work-packages/:id/advance`
      routes in `server.ts`.
- [ ] Add the PATCH /tasks/:id terminal-transition hook (source==="work-package"
      → advance), try/catch-guarded.
- [ ] Watch pass.

## Task 4 — Daemon loop wiring + console controls (RED → GREEN)

- [ ] Add console test: source includes a Start-package control
      (`startWorkPackage` / `wpStart`) and still no run-all.
- [ ] Run, watch fail.
- [ ] Wire `startWorkPackageOrchestrationLoop()` in `src/daemon/index.ts`.
- [ ] Add Start/Advance buttons + `wpStart`/`wpAdvance` handlers in `console.ts`.
- [ ] Watch pass.

## Task 5 — Gates + finish

- [ ] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs` — all clean.
- [ ] Update COMPONENT-MAP note (orchestration loop) if needed.
- [ ] Commit + push to main. Report hash, files, gates, next slice. No release.
