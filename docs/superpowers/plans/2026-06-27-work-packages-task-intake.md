# Work Packages + Task Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-27-work-packages-task-intake-design.md`.
TDD throughout: write the failing test, watch it fail, write minimal code, watch
it pass. Gates at the end: `npm run typecheck`, `npm test`,
`node scripts/scope-wall.mjs`.

---

## Task 1 — Task Intake pure module (RED → GREEN)

- [ ] Write `src/lib/intake/classify.test.ts` covering: small → `normal_task`;
      broad "fix all/build deploy/many updates" → `work_package_candidate` (≥2
      items); same-project active task → hold/collision; "worktree" wording →
      item `worktree_parallel`; release/deploy wording → item
      `executionMode: hold`.
- [ ] Run tests, watch the intake tests fail (module missing).
- [ ] Implement `src/lib/intake/classify.ts`:
  - export `IntakeInput`, `IntakeResult`, `ProposedItem` types.
  - export `classifyIntake(input): IntakeResult` — deterministic rules per design
    §6. Risk regexes, breadth signals, collision logic, shallow decomposition.
  - reuse `deriveTaskTitle` from `@/lib/tasks/derive-title` for item titles.
  - no IO, no LLM, no DB.
- [ ] Watch the intake tests pass.

## Task 2 — Work Package persistence migration (RED → GREEN)

- [ ] Write `src/lib/db/work-packages-schema.test.ts` (mirror
      `browser-lane-schema.test.ts`): assert `work_packages` and
      `work_package_items` tables exist with the design's columns.
- [ ] Run, watch fail.
- [ ] Add migration **v27** to `MIGRATIONS` in `src/lib/db/index.ts` (append
      only) with both `CREATE TABLE` statements + indexes per design §7.
- [ ] Watch schema test pass.

## Task 3 — Work Package store (RED → GREEN)

- [ ] Write `src/lib/work-packages/store.test.ts`: create from intake; list;
      get detail with item counts; update package + item; `createTaskFromItem`
      creates exactly ONE task and is idempotent; serialized package JSON
      contains no secrets (feed a prompt with `api_key=...` and assert
      redaction).
- [ ] Run, watch fail.
- [ ] Implement `src/lib/work-packages/store.ts` mirroring `runs.ts`:
  - `SECRET_KEY` redaction + `scrubSecretText`.
  - types `WorkPackageRecord`, `WorkPackageItem`, `WorkPackageDetail`.
  - `createWorkPackage`, `listWorkPackages`, `getWorkPackage`,
    `updateWorkPackage`, `updateWorkPackageItem`, `createTaskFromItem`,
    `resolveItemConcurrency`.
- [ ] Watch store tests pass.

## Task 4 — APIs in server.ts (RED → GREEN)

- [ ] Add server tests (in `src/daemon/server.test.ts`): POST
      `/work-packages/intake/preview` returns an IntakeResult; POST
      `/work-packages` + GET list/detail + PATCH round-trip; POST
      `…/items/:itemId/create-task` creates one task.
- [ ] Run, watch fail.
- [ ] Add routes in `src/daemon/server.ts` (dynamic `import()` per existing
      style), all secret-free, placed near the workflows routes.
- [ ] Watch pass.

## Task 5 — POST /tasks integration (RED → GREEN)

- [ ] Add server tests: a broad prompt → `routed: "work_package"` with a
      `packageId` and NO generic agent task created; existing YouTube / Terminal
      Lane / AI-news routes still 201 (regression).
- [ ] Run, watch the new broad-prompt test fail.
- [ ] Insert `classifyIntake` call in POST /tasks after the YouTube route, before
      the generic `Task.create`; on `work_package_candidate` create a draft/held
      package and return the structured response. Otherwise fall through
      unchanged.
- [ ] Watch pass; confirm regression tests still green.

## Task 6 — Console Work Packages panel (RED → GREEN)

- [ ] Add server/console tests: `CONSOLE_HTML` includes a Work Packages panel
      (`id="work_packages_list"` / `renderWorkPackages`) and does NOT include an
      auto-run-all control (assert no `runAllPackageItems` / "Run all items").
- [ ] Run, watch fail.
- [ ] Add the panel markup + `renderWorkPackages()` JS + per-item action
      handlers (createTaskFromItem / hold / mark ready / cancel) in
      `src/daemon/console.ts`; wire into the Lanes tab refresh. Collision/
      parallelism banner from `intake_json`.
- [ ] Watch pass.

## Task 7 — Gates + finish

- [ ] `npm run typecheck` — zero errors.
- [ ] `npm test` — all passing.
- [ ] `node scripts/scope-wall.mjs` — zero violations.
- [ ] Update `COMPONENT-MAP.md` / `CHANGELOG.md` if the conventions call for it
      (additive note only).
- [ ] Commit and push to main. Report commit hash, changed files, gates,
      recommended next slice. **No release** unless explicitly asked.
