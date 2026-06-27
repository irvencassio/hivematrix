# Work Package Ready-Item Orchestration — Design

> Superpowers brainstorming artifact. Date: 2026-06-27.
> Follow-up slice to `2026-06-27-work-packages-task-intake-design.md`.
> Topic: once an operator starts a Work Package, run its `ready` items in
> dependency order, respecting conservative same-repo concurrency, with the
> held final-gate enforced — driven by BOTH an event hook and a lightweight
> reconcile loop.

## 1. Problem

The MVP stages a Work Package and lets an operator convert one item at a time.
There is no mechanism to *run the package*: pick the next eligible item(s), start
them, and advance as each child completes. We want that orchestration — but
conservative and operator-gated, never a silent swarm.

## 2. Scope

In scope:
- A deterministic **planner** (`planNextItems`) — pure, fully unit-testable.
- **Reconcile** item state from each item's linked task.
- **Advance** — reconcile + start eligible items + recompute package status.
- **Start** — the explicit operator action that puts a package into `running`.
- A **lightweight reconcile loop** (`tickWorkPackages` + a guarded
  `setInterval`, mirroring `startBrowserLaneReadinessLoop`) so a package still
  advances if a child completes outside the API (e.g. the in-process scheduler).
- An **event hook** on PATCH /tasks/:id terminal transitions for
  work-package-sourced tasks → advance immediately.
- Two APIs: `POST /work-packages/:id/start`, `POST /work-packages/:id/advance`.
- Console: a **Start package** / **Advance** control; live status reflects loop
  progress.

Out of scope (still): model-advised decomposition; unrestricted parallelism;
release-pipeline changes; worktree *provisioning* automation (we set the
worktree name; we don't create the worktree).

## 3. Principles preserved (from the MVP brief)

- Operator must explicitly **start** a package. Nothing auto-runs before that.
- Default same-repo non-worktree **writer concurrency = 1**.
- Parallel same-project work only when worktree-backed or read-only/safe.
- Release/build/deploy items are **held** (final-gated) and never auto-started —
  the operator must explicitly mark them `ready`.
- Models advise; deterministic policy decides — orchestration is 100%
  deterministic rules.

## 4. Eligibility — `planNextItems(detail, activeSameProject)`

Pure function. Returns the items that may START now.

An item is eligible iff **all** hold:
1. `item.status === "ready"`. (`draft`/`held`/`running`/`done`/`failed`/
   `cancelled` are never startable. Held release items require an explicit
   operator `ready` first.)
2. Every id in `item.dependsOn` belongs to an item whose status is `done`.
3. Concurrency allows it:
   - **worktree/safe** items (executionMode `worktree_parallel`/`safe_parallel`,
     or scopeHints include `worktree`/`read-only`) — always allowed (deps
     permitting). They may run in parallel with each other and with a writer.
   - **writer** items (everything else) — allowed only if there is currently **no
     active writer** in the same repo. Active writers =
     `activeSameProject.length` (external in-flight tasks, treated as writers)
     **plus** package items already `running` that are writers **plus** writer
     items selected earlier in this same plan pass. Effectively: at most one
     writer in flight per repo.

When several writers are eligible but only one slot is free, the lowest
`position` wins; the rest wait for the next advance.

## 5. Reconcile — `reconcileWorkPackage(id)`

For each item with a `createdTaskId`, read the linked task's status and map it
onto the item (only for items currently `running`/`review`, never resurrecting a
terminal item):

| task status | item status |
|-------------|-------------|
| `done` | `done` (capture `commitHash` from task output if present) |
| `failed` | `failed` (copy task error → `blocker`) |
| `cancelled` | `cancelled` |
| `review` / `needs_input` | `review` |
| `backlog` / `assigned` / `in_progress` | `running` |

Missing task (deleted) → leave the item as-is. Reconcile is idempotent.

## 6. Advance — `advanceWorkPackage(id)`

1. `reconcileWorkPackage(id)`.
2. `planNextItems(detail, activeSameProjectTasks(projectPath))`.
3. For each eligible item: `createTaskFromItem` (idempotent; sets item
   `running`, links `createdTaskId`).
4. Recompute package status from item statuses:
   - all items `done` → `done` (+`completedAt`).
   - any `running`/`ready`/`draft` remaining → `running`.
   - none runnable, ≥1 `review` → `review`.
   - none runnable, ≥1 `failed`, rest terminal → `failed`.
   - none runnable, only `held` left → `held` (waiting for operator).
5. Returns `{ started: itemIds[], package }`.

Advance is safe to call repeatedly (idempotent given stable child states).

## 7. Start — `startWorkPackage(id)`

The explicit operator action:
1. Promote `draft` items to `ready` (NOT `held` — held items stay held until the
   operator marks them ready, preserving the final gate).
2. Set package status `running`.
3. `advanceWorkPackage(id)`.

## 8. Lightweight loop — `tickWorkPackages` + `startWorkPackageOrchestrationLoop`

- `tickWorkPackages()`: one pass — for every package with status `running`, call
  `advanceWorkPackage`. Cheap: indexed query on `status='running'`. Catches the
  case where a child task completed via the in-process scheduler (no PATCH).
- `startWorkPackageOrchestrationLoop(intervalMs = 15_000)`: a guarded
  `setInterval` with a `running` reentrancy flag and `.unref()`, idempotent
  start/stop — a direct mirror of `startBrowserLaneReadinessLoop`. Wired in
  `src/daemon/index.ts` next to the other loops.

Belt-and-suspenders: the event hook gives instant advance; the loop guarantees
eventual advance even when the hook is missed.

## 9. Event hook — PATCH /tasks/:id

After a successful task update, if `task.source === "work-package"` and the new
status is terminal/review (`done`/`failed`/`cancelled`/`review`), look up the
owning package via `findItemByTaskId(taskId)` and call `advanceWorkPackage`.
Wrapped in try/catch — a hook failure never breaks the task update. The loop is
the backstop.

## 10. Store additions

- `findItemByTaskId(taskId)` → `{ packageId, itemId } | null` (for the hook).
- `setItemStatusFromTask(...)` lives inside reconcile (private).
- Reuse existing `createTaskFromItem`, `updateWorkPackageItem`,
  `updateWorkPackage`, `getWorkPackage`.

## 11. APIs

- `POST /work-packages/:id/start` → `startWorkPackage` → 200 `{ started, package }`.
- `POST /work-packages/:id/advance` → `advanceWorkPackage` → 200 `{ started, package }`.

## 12. Console

- Per-package **Start package** button (when status `draft`/`held`) and an
  **Advance** button (when `running`). Both call the new endpoints and refresh.
- No "run all items" control — start/advance respect the planner; concurrency
  and the held gate are enforced by policy, not the UI.

## 13. Testing (TDD)

`src/lib/work-packages/orchestrate.test.ts`:
- planNextItems: ready+deps-done is eligible; dep-not-done is blocked; held never
  eligible; writer concurrency 1 (second writer waits); worktree/safe run in
  parallel; external active same-project task blocks a writer.
- startWorkPackage: promotes draft→ready (not held), starts only the first writer,
  package→running.
- advance after a child marked done: dependent item starts; package→done when all
  done.
- tickWorkPackages: a running package whose child is done advances on a tick.

`src/lib/work-packages/store.test.ts`: `findItemByTaskId` round-trips.

`src/daemon/server.test.ts`:
- POST /:id/start then mark the child task done via PATCH /tasks/:id → the next
  item gets a task automatically (event hook).
- held release item is not auto-started by start/advance.
- console source includes a Start-package control and still no run-all.

## 14. Risks

- **Double-start race** (hook + loop both advance): guarded by
  `createTaskFromItem` idempotency (returns the existing task) and the loop's
  reentrancy flag.
- **Stuck package** (a child wedged in review): advance leaves it `review`; the
  operator resolves the child, which re-fires the hook. The loop keeps it live.
- **Writer starvation across packages**: external active-task counting is
  conservative (treats unknown external work as a writer) — may delay a worktree
  item only if mis-tagged; acceptable for MVP.
