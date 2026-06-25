# Brain Scaffold Lane Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Task 1: Lock Brain Scaffold Naming

- [x] Update `src/lib/brain/memory-bundle.test.ts` expectations before production changes.
- [x] Assert `ensureHiveBrainScaffold` creates lane docs under `projects/hive/lanes/`.
- [x] Assert generated scaffold content uses lane names and not old public Bee names.
- [x] Assert `buildBrainMemoryBundle({ bee: "managerbee" })` renders `Lane Playbook (manager)`.
- [x] Update `src/lib/brain/selection.test.ts` fixture paths to lane docs.
- [x] Run `npm test -- src/lib/brain/memory-bundle.test.ts src/lib/brain/selection.test.ts` and confirm it fails before production changes.

## Task 2: Update Brain Scaffold And Bundle Lookup

- [x] Update `src/lib/brain/memory-bundle.ts`.
- [x] Add a lane slug mapping from compatibility worker ids to public lane doc names.
- [x] Read `lanes/<lane>.md` first and fall back to `bees/<id>.md` for existing memory.
- [x] Rename generated scaffold copy and paths to lane language.
- [x] Run `npm test -- src/lib/brain/memory-bundle.test.ts src/lib/brain/selection.test.ts` and confirm it passes.

## Task 3: Verify And Ship

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Commit and push to `main`.
