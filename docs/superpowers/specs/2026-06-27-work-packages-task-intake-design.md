# Work Packages + Task Intake — Design

> Superpowers brainstorming artifact. Date: 2026-06-27.
> Topic: a lightweight Task Intake preflight + a durable Work Package parent
> object, so HiveMatrix can safely stage many related updates instead of turning
> a broad prompt into one messy task or a swarm of colliding ones.

## 1. Problem

HiveMatrix grew from a task runner into a solo-founder operating system. It now
has normal board tasks, workflows/runs/actions, COO routing, Browser Lane /
Terminal Lane, voice-created tasks, and three execution tiers (local Qwen,
Claude/frontier, Codex). Three recurring failure modes show up:

1. **Broad prompts become one messy task.** "Fix all the lint errors and ship a
   release" lands as a single agent task with no staging, no sequencing, no
   review gate.
2. **Same-repo collisions.** A new task starts writing to a repo where another
   non-worktree task is already mid-flight; they clobber each other (see the
   `concurrent-sessions-hazard` memory — one writer per repo working tree).
3. **Risky steps run unsupervised.** Release/build/deploy/publish wording gets
   executed without a final human gate.

We want a **preflight** that classifies every new task cheaply, keeps small
tasks exactly as they are today, and promotes broad/risky/colliding prompts into
a reviewable **Work Package** draft with proposed child items — without
auto-running anything.

## 2. Scope (MVP)

In scope:

- A **pure, deterministic Task Intake module** (`src/lib/intake/`) — rule-first
  classification, no live LLM calls.
- **Work Package persistence** — `work_packages` + `work_package_items` tables,
  additive migrations only, with a secret-scrubbing store mirroring
  `src/lib/workflows/runs.ts`.
- **Package creation from intake** — a broad prompt creates a `draft`/`held`
  package, never a swarm of running tasks.
- **APIs** under `/work-packages` + an intake preview endpoint.
- **Light integration with POST /tasks** — intake runs after the existing
  special routes (AI-news video, Terminal Lane, YouTube summary) and before
  generic agent creation; a `work_package_candidate` yields a package, not an
  agent task.
- **Console UI** — a compact Work Packages panel with per-item actions and
  collision/parallelism warnings. No "run all" button.
- **Tests + docs.**

Explicit non-goals (carried from the brief): no multi-model LLM planning, no
auto-run of children, no unrestricted same-project parallelism, no release-
pipeline change, no directive/workflow rewrite, no removal of existing behavior.

## 3. Terminology

- **Work Package** — the durable parent object. Product copy says "Work
  Package". `macro_task` may appear ONLY as a hidden internal alias if ever
  needed; it is not used in the MVP.
- **Task Intake** — the automatic classification/preflight layer.
- **Item** — a `work_package_items` row; a proposed child unit of work that an
  operator can explicitly convert into exactly one normal task.

## 4. Design principles (encoded)

1. Don't make every small request a heavy package — intake returns
   `normal_task` for the common case and POST /tasks behaves exactly as today.
2. Every task runs through lightweight intake (cheap, pure, deterministic).
3. Broad requests → a Work Package *draft* with proposed child items.
4. Same-project parallelism is conservative.
5. Default same-repo non-worktree **writer concurrency = 1**.
6. Same-project parallel work is allowed only when worktree-backed or
   read-only/safe.
7. Release/build/deploy steps are held / final-gated unless explicitly approved.
8. Human approval required for destructive, credentialed, publish/send/deploy,
   high-risk actions.
9. **Models advise; deterministic HiveMatrix policy decides.** The MVP intake is
   100% deterministic rules — the model tiers below describe where advice *would*
   plug in later, but policy/locks/queue/audit stay in HiveMatrix.

## 5. Model policy (documented, not all wired in MVP)

| Tier | Role | MVP status |
|------|------|-----------|
| Qwen / local | cheap scout / classifier / extractor; never final authority for risky execution | intake is deterministic; Qwen is a *future* advisory extractor |
| Light frontier | optional cheap validation / risk classification | future advisory only |
| Claude / frontier | planner / reviewer for broad or ambiguous packages | operator-invoked later; not auto |
| Codex | scoped implementer/executor for approved package items | reuses existing task execution when an item is converted |
| HiveMatrix | policy, locks, queue, audit, UI | **this slice** |
| Operator | approval at risky boundaries | **this slice** (explicit start/ready/hold) |

## 6. Task Intake module

`src/lib/intake/classify.ts` — a single pure function plus small helpers.

### Input

```ts
interface IntakeInput {
  title?: string;
  description: string;
  project?: string;
  projectPath?: string;
  model?: string;
  source?: string;       // dashboard | voice | workflow | ...
  executor?: string;     // agent | workflow | terminal-lane | ...
  attachments?: { count: number; kinds?: string[] };  // metadata only, never content
  // Active same-project work, supplied by the caller (server queries the DB):
  activeSameProject?: { taskId: string; title: string; worktreeName?: string | null }[];
}
```

### Output

```ts
interface IntakeResult {
  kind: "normal_task" | "workflow" | "lane_task" | "work_package_candidate" | "held";
  confidence: number;            // 0..1
  reasons: string[];             // human-readable rule hits
  risk: "low" | "medium" | "high";
  suggestedMode: "run_now" | "hold" | "split" | "sequential" | "safe_parallel" | "worktree_parallel";
  projectCollision?: {
    active: boolean;
    activeTaskIds: string[];
    recommendation: "hold" | "worktree_parallel" | "safe_parallel";
  };
  packageCandidate?: {
    title: string;
    items: ProposedItem[];       // proposed child items when broad enough
  };
}

interface ProposedItem {
  title: string;
  prompt: string;
  risk: "low" | "medium" | "high";
  executionMode: "run_now" | "hold" | "sequential" | "safe_parallel" | "worktree_parallel";
  scopeHints: string[];
  dependsOn: string[];           // proposed item titles this depends on (resolved to ids on persist)
}
```

### Deterministic rules (rule-first)

Signals are computed from the text; the highest-priority matching rule wins.

- **Lane/workflow passthrough.** If `executor`/`source` already indicates a lane
  or workflow (`terminal-lane`, `workflow`, `video-review`, `browser-lane`),
  intake returns `lane_task`/`workflow` and the server's existing routes own it.
  Intake never re-routes those.
- **Risk detection.** Regex families:
  - `release/deploy/publish/build & ship` → `risk: high`, item
    `executionMode: hold` (final-gated). Words: `release`, `deploy`, `publish`,
    `ship it`, `push to prod`, `npm publish`, `build and deploy`.
  - destructive: `delete`, `drop table`, `rm -rf`, `force push`, `wipe` →
    `risk: high`.
  - credentialed/send: `send email`, `send sms`, `charge`, `transfer`,
    `api key`, `credentials` → `risk: high`.
  - otherwise `medium` if broad, else `low`.
- **Breadth detection (→ `work_package_candidate`).** A prompt is broad when it
  hits ≥1 breadth signal:
  - "fix all" / "all the" / "every" / "everything"
  - explicit multi-step enumeration: "1." & "2.", or "and then", or ≥3
    bullet/newline-separated imperatives
  - "refactor the whole" / "across the codebase" / "migrate"
  - combination phrases: "build, test, and deploy", "fix … and release …"
  When broad, intake decomposes into `ProposedItem[]` (see decomposition below)
  and sets `kind: work_package_candidate`, `suggestedMode: split`.
- **Collision detection.** If `activeSameProject` is non-empty:
  - if the incoming work (or any package item) is a writer and no worktree is
    requested → `projectCollision.recommendation: "hold"`,
    `suggestedMode: hold`, and `kind` can be elevated to `held` for a
    single-task writer, OR each colliding item is set to `hold`.
  - if worktree-backed (text mentions "worktree" or input requests it) →
    `worktree_parallel`.
  - if read-only/safe (text is clearly read-only: "review", "summarize",
    "audit", "read", "report") → `safe_parallel`.
- **Default.** No breadth, no blocking collision → `kind: normal_task`,
  `risk: low|medium`, `suggestedMode: run_now`. **This is the common path and
  must dominate.**

### Decomposition (deterministic, conservative)

For MVP, decomposition is heuristic and shallow — we do NOT call an LLM:

- Split on explicit enumerators (`1.`, `2.`, `-`, `*`, newlines) and on
  conjunctions joining imperatives ("and then", ", and ").
- Each fragment becomes a `ProposedItem` with a derived title (reuse
  `deriveTaskTitle`).
- Per-item risk re-runs the risk regexes on the fragment.
- Release/deploy fragments get `executionMode: hold` and are ordered LAST via
  `dependsOn` on all prior items (final gate).
- If only one fragment survives, intake falls back to `normal_task` (don't make a
  package for a single step). A package needs ≥2 items.

## 7. Persistence

Two additive migrations (next free `user_version`, currently 26 → add v27).

```sql
-- v27: Work Packages — Task Intake parent object + items. Secret-free:
-- description/prompt/scopeHints/blocker are scrubbed by the store on write.
CREATE TABLE IF NOT EXISTS work_packages (
  _id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  project TEXT NOT NULL DEFAULT 'hivematrix',
  projectPath TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',         -- draft|held|ready|running|review|done|failed|cancelled
  sourceTaskId TEXT,
  modelPolicy TEXT NOT NULL DEFAULT 'mixed_orchestrated',
  orchestrationMode TEXT NOT NULL DEFAULT 'sequential', -- sequential|safe_parallel|worktree_parallel|hold
  intake_json TEXT NOT NULL DEFAULT '{}',        -- the IntakeResult snapshot (secret-scrubbed)
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  completedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_work_packages_status ON work_packages(status, createdAt);
CREATE INDEX IF NOT EXISTS idx_work_packages_project ON work_packages(projectPath, status);

CREATE TABLE IF NOT EXISTS work_package_items (
  _id TEXT PRIMARY KEY,
  packageId TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',          -- draft|held|ready|running|review|done|failed|cancelled
  risk TEXT NOT NULL DEFAULT 'low',              -- low|medium|high
  dependsOn TEXT NOT NULL DEFAULT '[]',          -- JSON array of item ids
  scopeHints TEXT NOT NULL DEFAULT '[]',         -- JSON array
  executionMode TEXT NOT NULL DEFAULT 'sequential',
  createdTaskId TEXT,
  resultTaskId TEXT,
  commitHash TEXT,
  blocker TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_work_package_items_pkg ON work_package_items(packageId, position);
```

Statuses (both levels): `draft, held, ready, running, review, done, failed,
cancelled`. Terminal: `done, failed, cancelled` (sets `completedAt` on package).

### Store (`src/lib/work-packages/store.ts`)

Mirrors `runs.ts`: `SECRET_KEY` regex redaction on JSON writes, typed records
with parsed JSON, functions:

- `createWorkPackage(input)` → draft package + items (status defaults to the
  intake-suggested hold/ready).
- `listWorkPackages(filter)` / `getWorkPackage(id)` (detail incl. items + counts).
- `updateWorkPackage(id, patch)` — status/title/description/orchestrationMode.
- `updateWorkPackageItem(pkgId, itemId, patch)` — status/risk/executionMode/
  blocker/createdTaskId/resultTaskId/commitHash.
- `createTaskFromItem(pkgId, itemId)` — creates **exactly one** normal task via
  `Task.create`, links `createdTaskId`, sets item status `running` (or `ready`
  → `running`). Guards against double-creation (idempotent: returns the existing
  task id if `createdTaskId` already set).

Concurrency policy helper lives here too: `resolveItemConcurrency(item, active)`
enforces principle 5/6 (writer concurrency 1 unless worktree/safe).

## 8. APIs (server.ts)

All secret-free (store scrubs; responses carry parsed records):

- `POST /work-packages/intake/preview` — body = IntakeInput-ish; runs intake
  with active same-project tasks looked up from the DB; returns `IntakeResult`.
- `POST /tasks/intake/preview` — alias of the above for console New-Task
  preflight.
- `POST /work-packages` — create a package (from an intake result or explicit
  items).
- `GET /work-packages` — list (optional `?status=`).
- `GET /work-packages/:id` — detail with items + counts.
- `PATCH /work-packages/:id` — update status/fields.
- `PATCH /work-packages/:id/items/:itemId` — update item.
- `POST /work-packages/:id/items/:itemId/create-task` — convert one item → one
  task.

## 9. POST /tasks integration

Insert the intake check **after** the YouTube-summary route and **before** the
generic `Task.create` fallback. Logic:

```
intake = classifyIntake({ ...body, activeSameProject: <DB query> })
if (intake.kind === "work_package_candidate") {
  pkg = createWorkPackage({ fromIntake: intake, sourceTask: null, ... })  // draft/held
  broadcast("work-packages:created")
  return 201 { routed: "work_package", packageId, status, itemCount, intake }
}
// (held single-writer collision: still create the task but mark it 'backlog'/held —
//  MVP keeps it minimal: surface the collision in the response, create as today.)
// else fall through to existing normal Task.create — UNCHANGED behavior.
```

The existing special routes stay first and untouched, so YouTube / Terminal Lane
/ AI-news video keep passing. Intake only intercepts genuinely broad prompts;
everything else falls through to today's path.

## 10. Console UI

Add a compact **Work Packages** panel (Lanes settings tab, near Workflows, OR a
dedicated section — MVP: in the Lanes tab alongside Workflows for cohesion):

- Header with ↻ Refresh; list of packages showing status badge, title, project,
  and item counts by status (held/ready/running/review/done/failed).
- Expand a package → item list. Each item row shows title, risk badge,
  executionMode, status, and **explicit action buttons**: Create task, Hold,
  Mark ready, Cancel.
- Collision/parallelism warnings rendered as a visible banner on the package
  (from `intake_json` / item executionMode).
- **No "run all" / auto-run button** — enforced by a test asserting the console
  source contains the panel and does NOT contain a run-all control.
- The existing New Task flow is untouched and not buried.

## 11. Task controls

Hold/resume exist for **package items** via `PATCH …/items/:itemId` (status
`held` ↔ `ready`). Direct board-task hold is out of scope for this slice unless
trivially safe; documented as a follow-up. No destructive cancel semantics —
"Cancel" sets item/package status to `cancelled` (a state), it does not delete.

## 12. Testing strategy (TDD)

`src/lib/intake/classify.test.ts`:
- small prompt → `normal_task`
- broad "fix all / build deploy / many updates" → `work_package_candidate` with
  ≥2 items
- same-project active task → hold/collision recommendation
- worktree wording → item `worktree_parallel`
- release/deploy wording → item `executionMode: hold` (final-gated)

`src/lib/db/work-packages-schema.test.ts`: tables + columns migrate.

`src/lib/work-packages/store.test.ts`: create/list/get/update; create-task makes
exactly one child task; no secrets in serialized package JSON.

`src/daemon/server.test.ts` (additions): package APIs round-trip; intake preview;
existing YouTube/Terminal Lane/AI-news routes still 201 and still don't create a
generic agent; console source includes the Work Packages panel and no
auto-run-all button.

## 13. Risks / trade-offs

- **Over-promotion** (making packages for non-broad prompts) would be annoying →
  mitigated by the ≥2-items rule and conservative breadth regexes; default is
  `normal_task`.
- **Heuristic decomposition is shallow** — acceptable for MVP; the model-advised
  decomposition is a documented follow-up (principle 9 keeps policy in HiveMatrix
  regardless).
- **Collision detection depends on the caller passing active same-project work**
  — the server supplies it from the DB; the pure module stays testable.

## 14. Follow-ups (out of scope)

- Model-advised decomposition (Qwen extractor → Claude planner) feeding
  `ProposedItem[]`, with HiveMatrix policy still deciding.
- Sequential/parallel **execution orchestration** of ready items (this slice
  only converts items to tasks one at a time on operator action).
- Direct board-task hold/resume.
- Worktree provisioning automation for `worktree_parallel` items.
