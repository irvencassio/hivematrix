# Brain / Memory Review Console Screen Design

## Context

`mockup-brain-review.html` (repo root) is a standalone, backend-less prototype
of a new console screen: a three-pane **Brain / Memory Review** view that lets
the operator see, per project, which brain documents feed into agent tasks —
and archive or exclude the ones that shouldn't. Panes:

- **Left** — project picker, with a pinned **"Always loaded"** pseudo-project
  (global files pulled into every task, any project) above the normal project
  list. Each row shows a doc count.
- **Center** — the selected project's document list. Each doc carries a
  **status** (⭐ Main brief · 🟢 In task ctx · 🔵 Indexed only · ⚪ Orphaned ·
  🟠 Stale), a checkbox for multi-select, and a toolbar with **Archive
  selected** and **Exclude from context**. Archived docs appear struck-through
  below a divider.
- **Right** — a render pane with a **Rendered / Raw** toggle showing the doc's
  markdown.

The mockup is data-mocked (`PROJECTS`/`PINNED` literals) and explicitly labels
itself "no backend wired." This spec turns it into a real, wired console screen.

**The central design tension:** the mockup's status taxonomy *idealizes*
HiveMatrix's actual context behavior. Before implementing, we must map each
mockup status to what the code really does, and decide — per status — whether to
**report reality** or **change behavior to match the mockup**. §0 does this
mapping; the Approved Approach commits to reporting reality first and flags the
one behavior-change as an explicit, optional later phase.

## 0. Verified facts (mockup vs. code — resolved before implementation)

Checked against the codebase on 2026-07-09 (commit `0da38a4`). An implementer
treats these as given; do not re-derive.

**Brain root & layout.** `configuredBrainRootDir()`
(`src/lib/brain/settings.ts:50`) reads `memory.brainRootDir` from
`~/.hivematrix/config.json`, default `~/_GD/brain` (`types.ts:118`) — commonly a
Google Drive mount, so **every brain read must stay async + timeout-bounded**
(reuse the wrappers at `memory-bundle.ts:22-31`, `listDirWithTimeout` at
`186-204`). Project docs live under `<brainRoot>/projects/<slug>/`. The scaffold
(`hiveBrainScaffold`, `memory-bundle.ts:247-423`; `ensureHiveBrainScaffold`,
`425-438`) writes `agent-brief.md`, `current-state.md`, `decisions.md`,
`known-issues.md`, `lanes/*.md`, and `runbooks|evaluations|retrospectives|
references/README.md` — **for `projects/hive` only**.

**What is actually auto-loaded into tasks** (the crux — this is the truth behind
"brief"/"ctx"):
- `buildBrainMemoryBundle()` (`memory-bundle.ts:137-184`) loads **full content
  only when the task's project slug === `hive`** (`147`): `agent-brief.md`
  (§"Agent Brief"), `known-issues.md`, and conditionally `lanes/<lane>.md` for
  the task's lane. **`current-state.md` and `decisions.md` are scaffolded but
  never loaded** — the mockup calls this out correctly (they show as stale/
  indexed).
- `buildBrainIndexBlock()` (`memory-bundle.ts:214-245`) injects a **filename-only
  listing** (≤12 projects × 6 recent docs) telling the agent to use
  `brain_search`. This is "awareness," not content.
- Wiring differs by harness: the **local/Qwen agent** injects both the full
  bundle and the index block on every task (`generic-agent.ts:142-166`); the
  **Claude CLI path** injects the index block always but the full bundle **only
  for mission tasks** (`subprocess.ts:594`); the **Flash/voice loop** front-loads
  nothing and instead live-searches (`flash/context.ts:73-121`).
- ⇒ **"loaded into EVERY task for that project" is literally true only for
  `hive` on the local-agent path.** For any other project, nothing from
  `projects/<slug>/` is auto-loaded today. This is the behavior-change fork
  (§8).

**Search / indexed.** Two systems; one live. Keyword `searchBrain()`
(`brain/search.ts:130-176`, served `GET /brain/search`, `server.ts:3419`) reaches
**every text file under the root** — so "keyword-reachable" is near-universal and
is *not* a meaningful "indexed" signal. The semantic index is a JSON sidecar
`~/.hivematrix/embeddings-index.json` (`embeddings/index-store.ts:22-26`), built
by `reindexBrain()` (`embeddings/indexer.ts:66-99`) when embeddings are enabled;
per-path membership = a key in `loadIndex().entries`. The SQLite FTS store
(`brain/index-db.ts`) is **dead code** (imported only by its own tests) — do not
build against it.

**Stale.** Half real: `findStale()` (`brain/hygiene.ts:63-70`, default 180 days,
served `GET /brain/hygiene`, `server.ts:1678`) flags by **mtime**. The mockup's
"mentions a removed feature" content-scan is **fully net-new** and is dropped
from v1 (§2, deferred).

**Orphaned.** No existing computation. Net-new but derivable from primitives
(§2). Must be defined as "not auto-loaded AND not semantically indexed AND no
backlinks (`brain/links.ts:95-98`)" — never "not keyword-searchable," since
keyword search reaches everything.

**Always-loaded (CLAUDE.md / MEMORY.md).** Real files but **harness-native** —
the `claude` binary reads them; the daemon only *measures their byte size*
(`subprocess.ts:630-643`), it has **no read/list/write API** for them. Surfacing
them is net-new plumbing. (Persona memory under `<brainRoot>/persona/` *does*
have daemon APIs, but that's a different tree — out of scope for v1.)

**Archive / exclude.** **Fully net-new.** Nothing archives a doc or excludes it
from context today. The corpus walkers hardcode a skip set
(`.git/node_modules/.obsidian/.trash`, `search.ts:19`, `indexer.ts:15`,
hygiene). To *actually* keep a doc out of context+search, exclusion must be
enforced in **all** loaders/walkers, not just hidden in the UI (§5) — this is
the #1 correctness trap.

**No doc read/list endpoints exist.** `GET /brain/search` returns 300-char
snippets only; there is no "read this named doc" or "list a project's docs with
status" route. Both are net-new (§4).

**Console screens are center-pane render modes**, not routes. Nav buttons
(`ov-nav`) live in `.col.board` (`console.ts:1679-1682`): Overview / New task /
Chat. Each `show*()` (e.g. `showFlashPanel`, `console.ts:6368-6379`) clears the
mutually-exclusive state flags, sets its own, and renders `innerHTML` into
`#session`. `updateOverviewNav()` (`1985-1992`) syncs `.active`. Helpers:
`api(path,opts)` (`1883-1889`), `hmToast(msg,kind)` (`1895-1904`).

---

## Approved Approach

Build a real **Brain / Memory Review** center-pane screen wired to the daemon,
faithful to the mockup's layout and interactions, with these principles:

1. **Report reality, don't fake it.** Each doc's status is *derived from what the
   code actually does* (§2). Where the mockup implies behavior the code lacks
   (per-project brief loading, removed-feature staleness), we either defer it or
   gate it behind an explicit, separately-approved phase — never render a
   status that lies about whether a doc reaches tasks.
2. **Exclusion must be enforced, not cosmetic.** Exclude/Archive change what is
   loaded and indexed, enforced in the loaders and walkers (§5), or they are
   theater.
3. **Read-only for content in v1.** The pane previews docs; it does not edit
   their text. Archive/Exclude/Restore are the only mutations.
4. **Google-Drive-safe.** Every filesystem touch is async and timeout-bounded;
   no synchronous brain reads on the request path.

Scope decisions locked (2026-07-09):
- **Status = derived, live** (§2). "Stale" v1 = mtime only.
- **Archive = move file** to a skipped `_archived/` dir (real removal from
  context+search+index, restorable). **Exclude = a persisted flag** (lighter;
  drops from auto-load + semantic index, stays keyword-searchable) (§5).
- **"Always loaded" pane = read-only** surfacing of CLAUDE.md + MEMORY.md (§7).
- **Per-project brief generalization is deferred to an explicit optional Phase**
  (§8) — the core screen ships reporting today's reality.

---

## 1. Screen shell & navigation

Add a **🧠 Brain** nav button as an `ov-nav` in `.col.board`
(`console.ts:1679-1682`), after Chat. Implement `showBrain()` mirroring
`showFlashPanel` (`console.ts:6368-6379`): clear the other panel/selection flags,
set `_brainState.panelOpen = true`, render `brainPanelHtml()` into `#session`,
and add the `.active` toggle in `updateOverviewNav()` (`1985-1992`).

`brainPanelHtml()` renders the mockup's three-column `.shell` grid
(200px / 1fr / 1fr) scoped under an `.oc-center-pane`. Port the mockup CSS into
the console stylesheet using the **existing console CSS variables** (not the
mockup's hardcoded GitHub-dark hex) so it themes with the rest of the app. The
legend, toolbar, render-head toggle, confirm modal, and toast all map to
existing console equivalents — reuse `hmToast` instead of the mockup's private
toast, and the app's existing modal/confirm pattern instead of the bespoke
`.modal-overlay`.

State object `_brainState`: `{ panelOpen, project, doc, selected:Set, viewMode }`
— direct analogue of the mockup's module globals (`currentProject`,
`currentDoc`, `selected`, `viewMode`). `archived`/`excluded` are **not** client
state — they come from the server per doc (§4).

## 2. Status taxonomy (server-derived, authoritative)

The server computes each doc's status; the client only renders. Precedence
(first match wins):

| Status | Badge | Derivation (server) |
|---|---|---|
| **excluded** | 🔴 | operator exclusion flag set (§5). Overlays; shown as "Excluded" tag. |
| **brief** | ⭐ | filename is `agent-brief.md` at the project root **and** the project is actually brief-loaded (today: slug === `hive`; see §8). |
| **ctx** | 🟢 | in the auto-load set for this project — today `known-issues.md` and `lanes/<lane>.md` (`memory-bundle.ts:152-158`), `hive` only. |
| **stale** | 🟠 | mtime older than `staleDays` (from `findStale`, `hygiene.ts:63`). |
| **indexed** | 🔵 | present in the semantic index (`embeddings-index.json` entry) and not one of the above. |
| **orphan** | ⚪ | on disk, not auto-loaded, not semantically indexed, and no backlinks (`links.ts:95-98`). |

The mockup's per-doc `note` prose is **derived from status**, not stored:
e.g. brief → "Loaded in full into every task for this project",
indexed → "Reachable via brain_search, not auto-loaded", orphan → "On disk,
read by nothing", stale → "Not modified in N+ days". No note text is persisted.

**Deferred:** content-scan staleness ("mentions a removed feature"). Net-new,
low-confidence; note it in the UI copy as "age-based" so the operator isn't
misled. Revisit as a later enhancement with an explicit removed-feature list.

## 3. Data model returned to the client

Per doc (`BrainDocSummary`):
```
{ project, file, path,            // path = brain-relative, for display
  status, badge,                  // §2
  modified: epochMs, sizeBytes,
  indexed: boolean, backlinks: number,
  archived: boolean, excluded: boolean }
```
Per project row: `{ slug, label, docCount }`. Pinned pseudo-project uses
`slug = "__pinned__"` (mockup `PINNED_KEY`) and is always listed first.

## 4. New endpoints (net-new — none exist today)

All under `server.ts`, all reads async + timeout-bounded, all path-guarded to
resolve **inside** `brainRoot` (reject `..`/absolute escapes — a hard security
requirement, this route reads arbitrary files by name).

- **`GET /brain/projects`** → `[{slug,label,docCount}]` — walk
  `<brainRoot>/projects/*` (`listDirWithTimeout`). Distinct from `GET /projects`
  (that's the code-project list; this is the brain-doc-tree list).
- **`GET /brain/docs?project=<slug>`** → `BrainDocSummary[]` (active + archived;
  client splits on `archived`). For each file: `stat` for mtime/size; cross-
  reference the auto-load set (§2), semantic-index membership
  (`loadIndex().entries`), `findStale`, backlink count, and the exclusion set.
  `project=__pinned__` returns the pinned set (§7).
- **`GET /brain/doc?project=<slug>&file=<relpath>`** → `{ content, path,
  modified, sizeBytes }` raw markdown (bounded reader). This is what the render
  pane fetches on doc click — search snippets are insufficient.
- **`POST /brain/doc/exclude`** `{project, files:[], excluded:bool}` → toggle the
  exclusion flag (§5). Broadcast `brain:changed`.
- **`POST /brain/doc/archive`** `{project, files:[]}` and
  **`POST /brain/doc/restore`** `{project, files:[]}` → move to/from `_archived/`
  (§5). Broadcast `brain:changed`.

Rendering markdown: reuse the app's existing markdown renderer if one is wired
(the console already renders assistant markdown); otherwise port the mockup's
`tinyMarkdown` as a scoped helper. Raw view is `textContent`.

## 5. Archive & Exclude — enforcement (the correctness core)

**Exclude from context** = a persisted per-doc flag in a JSON sidecar
`~/.hivematrix/brain-exclusions.json` (keyed by brain-relative path; mirrors the
`embeddings-index.json` sidecar pattern). Enforced at **three** sites so it is
real, not cosmetic:
1. `buildBrainMemoryBundle` (`memory-bundle.ts:137`) — skip excluded files in
   the full-load set.
2. `buildBrainIndexBlock` (`memory-bundle.ts:214`) — omit from the awareness
   listing.
3. `reindexBrain` collect (`indexer.ts:32-55`) — drop from the semantic index
   (and prune any existing entry on next reindex).
Excluded docs **remain keyword-searchable** (still on disk) — "excluded from
context" means "not auto-loaded / not semantically indexed," matching the
mockup's lighter-weight action. Reversible by clearing the flag.

**Archive** = **move** the file to `<brainRoot>/projects/<slug>/_archived/`
(preserving sub-path). Add `_archived` to the shared skip set in **all** corpus
walkers (`search.ts:19` `SKIP_DIRS`, `indexer.ts:15`, hygiene, and the
`listDirWithTimeout` used by `buildBrainIndexBlock`). Because the walkers already
honor a skip set, archiving then removes the doc from context, search, *and*
index for free, while it stays on disk and restorable — satisfying the mockup's
"stays on disk under an archived state, can be restored later." **Restore** moves
it back. Both moves are async/bounded (GD-mount latency); on failure, surface an
error toast and leave the file in place (no partial state).

Archive shows the mockup's confirm modal (destructive-styling); Exclude is
immediate with a toast (matches mockup). Guardrails: **never archive/exclude the
active `agent-brief.md`** of a brief-loaded project without an extra confirm —
removing the main brief silently degrades every task. **Never delete** — archive
only ever moves.

## 6. Center + right panes

Port `renderDocs`/`buildDocRow`/`renderPane`/`paintBody` (mockup lines 477-572)
against the server data:
- Doc rows: badge, filename, `modified · size` sub-line, status tag, checkbox.
  Archived rows render struck-through below an "Archived (n)" divider
  (mockup 487-493) and their checkbox is disabled.
- Toolbar: "n selected", **Archive selected**, **Exclude from context**; both
  disabled at zero selection (mockup `updateToolbar`).
- Right pane: title + brain-relative path, Rendered/Raw toggle, body. Default-
  select the project's brief on open (mockup 629-631). Fetch content lazily via
  `GET /brain/doc` on row click; cache per doc within the session.

Live updates: on the `brain:changed` broadcast, re-fetch `/brain/docs` for the
current project so archive/exclude from another surface reflects immediately.

## 7. "Always loaded" pinned pseudo-project (read-only v1)

`GET /brain/docs?project=__pinned__` returns the global always-loaded set:
- **CLAUDE.md** — user-level (`~/.claude/CLAUDE.md`) and, if present, the
  project-level `CLAUDE.md` the local-agent path loads (`generic-agent.ts:178`).
- **MEMORY.md** — the harness memory index
  (`~/.claude/projects/<encoded>/memory/MEMORY.md`, `subprocess.ts:637`).

These are **harness-native**; the daemon gains a **read-only** surfacing path
here (new bounded readers), status forced to `brief` (⭐), badge shown, but
**Archive/Exclude disabled** for pinned docs (they're not in the brain tree and
their loading is owned by the CLI harness). The pane makes them *visible* — a
real gap today — without pretending the app controls their injection. Editing
them is out of scope (§ Out of scope).

## 8. Deferred / optional Phase — per-project brief generalization

The mockup's premise ("each project's brief is loaded into every task for that
project") is **not** today's behavior — only `hive` is brief-loaded, and only on
the local-agent path (§0). Two ways to reconcile, **decision required before
this phase runs**:

- **(A) Report-only (default, in the core phases):** statuses reflect reality.
  Non-`hive` projects show `agent-brief.md` as `indexed`/`orphan`, not `brief`,
  and the screen honestly shows that most brains aren't wired into context. Zero
  behavior change; safe.
- **(B) Generalize loading (optional Phase, behavior change):** extend
  `buildBrainMemoryBundle` to load `<brainRoot>/projects/<taskSlug>/agent-brief.md`
  + `known-issues.md` for *any* project whose slug matches the task's project,
  and make the Claude path honor it beyond mission tasks. This makes the ⭐/🟢
  statuses meaningful everywhere and is arguably the more valuable feature — but
  it changes the context bundle for every task and needs its own review, prompt-
  budget accounting (the N+1 readdir perf note in the scaffold brief), and
  tests. **Do not fold into the core screen without explicit sign-off.**

The core screen (Phases 1-6) is built to option A. If B is approved, the screen
needs no UI change — the same status logic lights up for every project once the
loader generalizes.

---

## Files touched (map)

| Area | File | Change |
|---|---|---|
| Endpoints | `src/daemon/server.ts` | `GET /brain/projects`, `/brain/docs`, `/brain/doc`; `POST /brain/doc/{exclude,archive,restore}`; `brain:changed` broadcasts |
| Doc status | `src/lib/brain/doc-review.ts` (new) | `listProjectDocs(slug)` + `classifyDoc()` — derives §2 status from auto-load set, index membership, hygiene, backlinks, exclusion |
| Exclusion | `src/lib/brain/exclusions.ts` (new) | JSON-sidecar get/set (mirror `features.ts`/`index-store.ts` patterns) |
| Loaders | `src/lib/brain/memory-bundle.ts:137,214` | honor exclusion set in full-load + index block |
| Index | `src/lib/brain/embeddings/indexer.ts:15,32` | add `_archived` to skip set; drop excluded from collect |
| Walkers | `src/lib/brain/search.ts:19`, `hygiene.ts` | add `_archived` to `SKIP_DIRS` |
| Archive | `src/lib/brain/archive.ts` (new) | bounded move to/from `projects/<slug>/_archived/`, path-guarded |
| Pinned | `src/lib/brain/pinned.ts` (new) | bounded read of CLAUDE.md/MEMORY.md locations |
| Console | `src/daemon/console.ts:1679,1985,6368` | `🧠 Brain` nav, `showBrain()`, `brainPanelHtml()` + render fns, `_brainState`, `brain:changed` handler, ported CSS (app vars) |

## Build plan for the implementing session

Ordered; each phase independently committable with a passing checkpoint. Run the
test suite (`node --test`) after each. **Read §0 first** — do not encode a status
that lies about task loading.

**Phase 1 — Read-only status derivation (server, no UI).**
- `brain/doc-review.ts`: `listProjectDocs(slug)` + `classifyDoc()` per §2/§3
  (exclusion always false for now). `GET /brain/projects`, `/brain/docs`,
  `/brain/doc` (bounded, path-guarded).
- Tests: classify fixtures → correct status precedence; path-traversal rejected;
  timeout wrapper used on every read.
- **Checkpoint:** `curl "/brain/docs?project=hive"` returns `agent-brief.md`=brief,
  `known-issues.md`=ctx, `current-state.md`=stale-or-orphan (NOT ctx),
  `scratch.md`-style files=orphan; `/brain/doc` returns raw content.

**Phase 2 — Brain screen (client, read-only).**
- `🧠 Brain` nav + `showBrain()` + `brainPanelHtml()` + ported three-pane render
  against Phase-1 endpoints; Rendered/Raw toggle; default-select brief.
- **Checkpoint (in-app):** screen opens, lists projects + pinned row, center
  shows real docs with correct badges, clicking a doc renders it; matches the
  mockup layout with app theming.

**Phase 3 — Exclude from context (enforced).**
- `brain/exclusions.ts` sidecar; `POST /brain/doc/exclude`; enforce in
  `buildBrainMemoryBundle` + `buildBrainIndexBlock` + indexer collect; wire the
  toolbar button + toast; status overlay 🔴.
- Tests: excluded doc absent from `buildBrainMemoryBundle` output and from a
  reindex collect; still keyword-searchable.
- **Checkpoint:** exclude `known-issues.md` in `hive` → it drops from the
  context bundle (assert on the built prompt) and shows Excluded; re-include
  restores it.

**Phase 4 — Archive / Restore (enforced by move).**
- `brain/archive.ts` bounded move; add `_archived` to all skip sets;
  `POST /brain/doc/{archive,restore}`; confirm modal; struck-through archived
  section; extra-confirm guard on archiving a live brief.
- Tests: archive moves the file under `_archived/` and it vanishes from
  `/brain/docs` active set, from search, and from index collect; restore
  reverses; failure leaves the file in place.
- **Checkpoint:** archive a doc → gone from context/search/index, present in the
  Archived section; restore → back.

**Phase 5 — Pinned "Always loaded" (read-only).**
- `brain/pinned.ts` + `project=__pinned__` branch; render pinned row first;
  Archive/Exclude disabled for pinned docs.
- **Checkpoint:** pinned row shows CLAUDE.md + MEMORY.md with real content;
  action buttons disabled for them.

**Phase 6 — Live sync & polish.**
- `brain:changed` broadcast + client re-fetch; empty/error states; GD-latency
  loading affordances; keyboard/hover parity with mockup.
- **Checkpoint:** archive/exclude reflects without manual refresh; slow brain
  root shows a loading state, never blocks the request thread.

**(Optional) Phase 7 — Per-project brief generalization (§8, option B).**
Only on explicit sign-off. Generalize the loader; add prompt-budget accounting;
tests that every project's brief/known-issues load for its own tasks. No UI
change.

### Global acceptance criteria

1. A `🧠 Brain` screen reachable from the console left nav, three-pane, themed
   with app variables, faithful to the mockup's layout and interactions.
2. Every doc's status is **derived from real behavior** — no status implies task-
   loading that doesn't happen (verified for `hive`: brief/ctx correct;
   `current-state.md`/`decisions.md` NOT shown as ctx).
3. **Exclude** removes a doc from the auto-load bundle *and* the semantic index
   (asserted on built artifacts), reversibly, while it stays keyword-searchable.
4. **Archive** moves the doc out of context, search, and index and into a
   restorable `_archived/` area; **nothing is ever deleted**.
5. Render pane shows real doc content with working Rendered/Raw toggle.
6. Pinned "Always loaded" surfaces CLAUDE.md + MEMORY.md read-only.
7. No synchronous brain read on any request path; slow/absent brain root
   degrades gracefully (empty/loading states), never hangs the daemon.
8. Archiving/excluding a project's live main brief requires an extra confirm.

### Guardrails for the implementer

- **Enforce exclusion in the loaders/walkers, not just the UI.** A doc the
  screen calls "excluded" that still lands in a task prompt is a bug, not a
  cosmetic gap. (§5, §0.)
- **Never delete a brain file.** Archive = move; restore = move back.
- **Path-guard every doc read/move** to stay inside `brainRoot`; reject `..` and
  absolute paths. This route reads/moves arbitrary named files.
- **Every fs touch async + timeout-bounded** — the brain root may be a
  dehydrated Google Drive mount. Reuse `memory-bundle.ts` wrappers.
- **Do not render a status you can't back with code.** If unsure whether a doc
  is loaded, classify by the real auto-load list (§2), not by filename
  convention.
- **Do not generalize brief-loading (§8-B) inside the core phases** — it changes
  every task's context and needs separate sign-off.
- **Pinned CLAUDE.md/MEMORY.md are read-only** — they're harness-owned; do not
  add write/archive/exclude paths for them in v1.
- Spec written against commit `0da38a4` (0.1.159). If the code has moved, stop
  and surface the delta rather than guessing.

## Out of scope (v1)

- In-pane **editing** of doc text (view + archive/exclude only).
- Write/archive/exclude for pinned CLAUDE.md/MEMORY.md (read-only surfacing).
- Content-scan staleness ("mentions a removed feature") — age-based only (§2).
- Per-task/per-mission include-exclude (the inert `brain/selection.ts` model) —
  exclusion here is global per doc.
- The dead SQLite FTS index (`brain/index-db.ts`) — build against the live JSON
  sidecar only.
- Persona-memory tree surfacing (`<brainRoot>/persona/`).

## Open risks

- **Google-Drive latency** dominates UX: a cold brain root can stall reads for
  seconds. Every endpoint must return a bounded/partial result with a loading
  affordance rather than blocking; consider a short-TTL cache of `/brain/docs`
  results.
- **"Orphaned" false positives:** if embeddings are disabled, nothing is
  semantically indexed, so many docs look orphaned. Gate the orphan status on
  "embeddings enabled" — when disabled, show "indexed status unknown" rather
  than mass-flagging orphans.
- **Archive on a shared/synced root:** moving files under a synced folder
  triggers sync churn; document that archive relocates within the same root so
  sync just moves it, and that `_archived/` is intentionally excluded from all
  brain reads.
- **Status honesty vs. mockup expectation:** on report-only (§8-A), most non-
  `hive` projects will look sparsely-wired, which may surprise the operator who
  saw the idealized mockup. The UI copy should make "in task ctx" mean exactly
  "loaded today," not "should be loaded."
