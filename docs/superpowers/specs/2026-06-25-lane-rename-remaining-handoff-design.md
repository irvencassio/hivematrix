# Lane Rename Remaining Work Handoff Design

## Current State

HiveMatrix `main` is clean at/after commit `3d1b007` (`fix(lanes): update remaining active source prose`). The lane rename work has already moved the visible Settings copy, operator docs, model-facing prompts, active source comments, and decision-memory language toward Lanes.

Recent verification on the latest slice:

- `npm run typecheck` passed.
- `npm test` passed with 950 tests.
- `node scripts/scope-wall.mjs` passed with 0 violations.

First-class lane routes already exist:

- `GET /lanes`
- `POST /lanes/:kind/autostart`
- `POST /lanes/:kind/restart`

Compatibility routes still exist intentionally:

- `GET /bees`
- `POST /bees/:kind/autostart`
- `POST /bees/:kind/restart`

## Goal For The Next Prompt

Finish the remaining Bee-to-Lane migration without breaking persisted tasks, old clients, local config, or route compatibility. The next worker should treat this as a staged compatibility migration, not a blind search-and-replace.

## Brutally Honest Boundary

The remaining work is deeper than visible wording. Most remaining `Bee` hits are contract names, persisted fields, compatibility ids, or old route aliases. Renaming them all at once will likely break:

- persisted task/output payloads with `bee` fields
- worker registration and central task lease contracts
- config keys such as `beeServices`
- compatibility routes and tests
- helper bundle names such as `DesktopBeeHelper.app`
- tool ids like `termbee_run`, `mailbee_send`, and `browserbee_run`

The correct strategy is: add lane-shaped APIs first, read both old and new shapes, write the new shape where safe, and only then consider removing old names in a later migration.

## Remaining Workstreams

### 1. Finish Operator-Facing Stragglers

Remaining active/operator-facing strings found after the latest cleanup:

- `docs/USER-GUIDE.html` still documents `GET /bees` and `POST /bees/:kind/autostart`.
- `voice-sidecar/talk.py` prints `bee: ...`.
- `voice-sidecar/live.py` prints `bee: ...`.
- `src/daemon/console.ts` builds Talk status text with `bee: ...`.
- `DECISIONS.md` still includes historical compatibility mentions. Most can stay, but future-facing language should call them legacy/compatibility where needed.

Recommended changes:

- Document `GET /lanes` and `POST /lanes/:kind/autostart` as the primary API in `docs/USER-GUIDE.html`.
- Mention `/bees` only as a compatibility alias.
- Change spoken/console status labels from `bee:` to `assistant:` or `lane:`. Prefer `assistant:` for voice readability.
- Add a focused regression test such as `scripts/remaining-operator-lane-copy.test.mjs`.

Acceptance criteria:

- No active operator-facing source/docs say `bee:` as a UI label.
- User guide points at `/lanes` first.
- `/bees` is described only as a compatibility alias.

### 2. Rename Lane Service Internals With Compatibility Facades

Current internals still use:

- `src/lib/bees/catalog.ts`
- `src/lib/bees/service-manager.ts`
- `BeeDefinition`
- `BeeServiceStatus`
- `BeeRole`
- `beeServices` config key

Recommended approach:

1. Add lane-native modules/types:
   - `src/lib/lanes/catalog.ts`
   - `src/lib/lanes/service-manager.ts`
   - `LaneDefinition`
   - `LaneServiceStatus`
   - `LaneRole`
   - `laneServices`
2. Keep `src/lib/bees/*` as thin compatibility facades for at least one release.
3. Make config read both `laneServices` and `beeServices`.
4. Write `laneServices` going forward, but preserve `beeServices` read fallback.
5. Keep `/bees` aliases returning old-shaped keys only where old clients expect them.

Acceptance criteria:

- New code imports lane service modules, not `@/lib/bees/*`.
- Old imports still work through compatibility facades.
- `GET /lanes` returns lane-shaped data.
- Existing `GET /bees` tests still pass.
- Config migration is covered by tests for old-only, new-only, and both-present states.

### 3. Migrate Central Protocol Naming Carefully

Current central contracts still use `bee` as a protocol field:

- `src/lib/central/contracts.ts`
- worker registration
- central task leases/events/status
- task output payloads such as `{ bee: "managerbee" }`

Recommended approach:

1. Add optional `lane` fields alongside existing `bee` fields.
2. Normalize input by accepting either `lane` or `bee`.
3. Emit both fields for one compatibility window, or emit `lane` primary plus `bee` only on compatibility routes.
4. Update model-facing/routing code to prefer `lane`.
5. Add migration tests before changing production code.

Do not remove `bee` fields until persisted records and external clients have a tested migration path.

Acceptance criteria:

- New API responses expose `lane`.
- Existing persisted records with `bee` still parse.
- Existing tests for central contracts continue to pass.
- New tests prove old and new field names round-trip safely.

### 4. Browser Lane Compatibility Id Reduction

Browser Lane still maps old ids:

- `browserbee`
- `webbee`
- `authbee`

This is currently deliberate. Browser Lane already consolidates display and status into `browser`, but lower-level capability ids and jobs still preserve old ids.

Recommended approach:

1. Keep old ids as compatibility ids.
2. Introduce canonical lane ids in new interfaces:
   - `browser`
   - `desktop`
   - `terminal`
   - `message`
   - `mail`
   - `memory`
   - `review`
   - `market-insight`
   - `voice`
3. Add explicit mapping helpers, not scattered switch statements.
4. Teach the COO/router table to route by canonical lane id, with compatibility aliases only at the edges.

Acceptance criteria:

- New routing/config code talks about `browser`, not `browserbee`/`webbee`.
- Existing `browserbee_run`/`webbee_search` tool ids remain callable until replaced by a versioned tool migration.
- Tests prove Browser Lane read/workflow status collapses into one operator-visible lane.

### 5. Router/COO Rule Table

The architecture direction is to avoid adding more skills for deterministic routing. The remaining design work should create a durable SQL-backed routing table the COO can inspect and maintain.

Recommended table sketch:

```sql
CREATE TABLE IF NOT EXISTS routing_rules (
  id TEXT PRIMARY KEY,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  intent_pattern TEXT NOT NULL,
  lane_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'any',
  provider_hint TEXT,
  risk_level TEXT NOT NULL DEFAULT 'normal',
  approval_policy TEXT NOT NULL DEFAULT 'default',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Recommended follow-up:

- Add CRUD helpers under `src/lib/routing/rules.ts`.
- Add daemon endpoints under `/routing/rules`.
- Add a COO/router test proving rules select lane ids, not old Bee ids.
- Add a console admin surface only after the API and tests are stable.

Acceptance criteria:

- Router can resolve at least browser, desktop, terminal, mail, message, and video/script-development intents from table-backed rules.
- Rules use canonical lane ids.
- Default seed rules do not mention public Bee names.

### 6. Removal/Archive Of Old Projects

The broader product decision was to remove Weaver, WebBee, and BrowserBee as standalone product concepts. In this repo, the old names are mostly compatibility ids rather than standalone projects. Before deleting anything, the next worker should verify whether any sibling repos still exist outside this worktree.

Recommended checks:

```bash
find /Users/irvencassio -maxdepth 3 -type d \( -iname '*weaver*' -o -iname '*webbee*' -o -iname '*browserbee*' \) 2>/dev/null
rg -n "Weaver|WebBee|BrowserBee" ~/.hive /Users/irvencassio 2>/dev/null
```

Do not delete sibling repos from this prompt unless the user explicitly approves deletion after the inventory is shown.

## What Should Stay For Now

Keep these until a later compatibility migration:

- `DesktopBeeHelper.app`
- `DESKTOPBEE_PORT`
- `com.hivematrix.desktopbee.helper`
- `src/lib/desktopbee/`
- `src/lib/mailbee/`, `src/lib/messagebee/`, `src/lib/termbee/`, etc.
- route aliases under `/bees`
- tool ids such as `mailbee_send`, `messagebee_send`, `termbee_run`, `desktopbee_action`, `browserbee_run`, `webbee_search`
- persisted fields named `bee` where old tasks/workers still use them

## Suggested Next Implementation Order

1. Operator-facing stragglers (`bee:` voice labels and user guide `/lanes` docs).
2. Lane service facade (`src/lib/lanes/service-manager.ts`) while preserving `src/lib/bees/*`.
3. Config migration from `beeServices` to `laneServices`.
4. Central contract dual-field support (`lane` plus `bee` fallback).
5. COO routing SQL table with canonical lane ids.
6. Optional external repo cleanup inventory for Weaver/WebBee/BrowserBee.

Each step should follow the repo Superpowers workflow: failing test first, minimal production/doc change, full gates, commit, push.

## Verification Gates

For every implementation slice:

```bash
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

For local-model/router-related work, also run:

```bash
npx tsx scripts/qwen-readiness.mts
```

## Hand-Off Prompt Seed

Use this to start the next prompt:

> Continue HiveMatrix lane rename cleanup from `docs/superpowers/specs/2026-06-25-lane-rename-remaining-handoff-design.md`. Start with operator-facing stragglers, then move to lane service facades. Follow AGENTS.md Superpowers workflow, write failing tests first, keep compatibility aliases, and do not delete or rename persisted Bee contracts without a tested migration.
