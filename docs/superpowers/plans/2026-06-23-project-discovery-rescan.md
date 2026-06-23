# Project Discovery Rescan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Add failing backend coverage in `src/lib/routing/project-discovery-cache.test.ts`.
  - Create `$HOME/.Trash/trashed-repo/.git` in the isolated test home.
  - Assert `discoverProjectsFresh()` does not return any path containing `/.Trash/`.

- [x] Add failing console coverage in `src/daemon/console.test.ts`.
  - Assert the header project area has a project rescan control.
  - Assert the project dropdown empty state includes a rescan control.
  - Assert `refreshProjects()` still calls `loadProjects(true)`.

- [x] Implement the discovery filter in `src/lib/routing/project-discovery.ts`.
  - Add a helper that rejects container paths, especially `$HOME/.Trash` and descendants.
  - Apply it to git, Claude Code, and VS Code source inserts before saving paths.

- [x] Implement the visible rescan controls in `src/daemon/console.ts`.
  - Add a small rescan button beside `(all projects)`.
  - Add a rescan action inside the project dropdown empty state.

- [x] Verify.
  - Run the focused tests.
  - Run `npm run typecheck`.
  - Run `npm test`.
  - Run `node scripts/scope-wall.mjs`.
