# Goals Data Loss + Test-DB Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-07-15-goals-data-loss-design.md`

Branch: `fix/goals-data-loss-db-test-isolation`, worktree
`.claude/worktrees/fix-goals-data-loss` (isolated from the primary working
tree, which has an unrelated concurrent task's uncommitted changes — do not
touch anything outside the files this plan names).

## Task 1 — RED: failing test for the prod-DB guard

File: `src/lib/db/resolve-db-path.test.ts` (new)

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";

// This test deliberately does NOT override HOME — it verifies that when
// nothing overrides it, resolveDbPath() refuses to hand back the real path
// under NODE_ENV=test, rather than silently returning it (the bug that
// wiped the live hivematrix.db on 2026-07-14: see
// docs/superpowers/specs/2026-07-15-goals-data-loss-design.md).
test("getDb() throws under NODE_ENV=test instead of opening the real prod DB", async () => {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    HIVEMATRIX_DB_PATH: process.env.HIVEMATRIX_DB_PATH,
    HIVEMATRIX_PROD_DB_GUARD: process.env.HIVEMATRIX_PROD_DB_GUARD,
  };
  try {
    delete process.env.HIVEMATRIX_DB_PATH;
    process.env.NODE_ENV = "test";
    // Mirrors what the npm "test" script sets from the real shell $HOME
    // before node starts — see package.json.
    process.env.HIVEMATRIX_PROD_DB_GUARD = join(homedir(), ".hivematrix", "hivematrix.db");

    const { getDb, _resetDbForTests } = await import("@/lib/db");
    _resetDbForTests();
    assert.throws(() => getDb(), /production database/i);
    _resetDbForTests();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k as keyof typeof process.env];
      else process.env[k as keyof typeof process.env] = v;
    }
  }
});

test("getDb() still opens normally when HIVEMATRIX_DB_PATH is set under NODE_ENV=test", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const TMP = mkdtempSync(join(tmpdir(), "hm-guard-regression-"));
  const saved = process.env.HIVEMATRIX_DB_PATH;
  process.env.NODE_ENV = "test";
  process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");
  try {
    const { getDb, _resetDbForTests } = await import("@/lib/db");
    _resetDbForTests();
    assert.doesNotThrow(() => getDb());
    _resetDbForTests();
  } finally {
    if (saved === undefined) delete process.env.HIVEMATRIX_DB_PATH; else process.env.HIVEMATRIX_DB_PATH = saved;
    rmSync(TMP, { recursive: true, force: true });
  }
});
```

Run `npx tsx --test src/lib/db/resolve-db-path.test.ts` and confirm the
first test **fails** (guard doesn't exist yet — `resolveDbPath()` currently
returns the real path unconditionally) and the second **passes** (no
regression, since `HIVEMATRIX_DB_PATH` is already set before the throw check
could even apply).

- [ ] Write the test file above, run it, confirm the RED state (first test
      fails with "expected function to throw" or similar, second passes).

## Task 2 — GREEN: implement the guard

File: `src/lib/db/index.ts` — replace `resolveDbPath()` (currently lines
11–16):

```ts
function resolveDbPath(): string {
  if (process.env.HIVEMATRIX_DB_PATH) return process.env.HIVEMATRIX_DB_PATH;
  const dir = join(homedir(), ".hivematrix");
  const path = join(dir, "hivematrix.db");
  // Fail closed: a test that forgets to isolate its DB (via HIVEMATRIX_DB_PATH
  // or a temp HOME override) must not silently fall through to the real
  // database. HIVEMATRIX_PROD_DB_GUARD is set by the "test"/"test:watch" npm
  // scripts from the invoking shell's real $HOME, captured before node starts
  // (so a test file overriding process.env.HOME later can't defeat it — an
  // overridden HOME resolves `path` to a temp dir here, which no longer
  // matches the guard value, so it's naturally exempt).
  if (process.env.NODE_ENV === "test" && path === process.env.HIVEMATRIX_PROD_DB_GUARD) {
    throw new Error(
      `resolveDbPath() would open the real production database (${path}) from a test. ` +
      `Set HIVEMATRIX_DB_PATH or override process.env.HOME to a temp dir before the ` +
      `first getDb() call — see src/lib/messagebee/store.test.ts for the pattern.`,
    );
  }
  mkdirSync(dir, { recursive: true });
  return path;
}
```

File: `package.json` — update both test scripts (lines 7–8) to set the guard
value from the real shell `$HOME` plus `NODE_ENV=test`:

```json
    "test": "HIVEMATRIX_PROD_DB_GUARD=\"$HOME/.hivematrix/hivematrix.db\" NODE_ENV=test node --import tsx/esm --test 'src/**/*.test.ts' 'scripts/**/*.test.mjs'",
    "test:watch": "HIVEMATRIX_PROD_DB_GUARD=\"$HOME/.hivematrix/hivematrix.db\" NODE_ENV=test node --import tsx/esm --test --watch 'src/**/*.test.ts' 'scripts/**/*.test.mjs'",
```

- [ ] Make the two edits above.
- [ ] Run `npx tsx --test src/lib/db/resolve-db-path.test.ts` — both tests
      pass now (GREEN).
- [ ] Run the **full** `npm test` — this is the critical regression check.
      All 39 existing DB-touching test files must still pass unchanged
      (they all already isolate via `HIVEMATRIX_DB_PATH` or a temp `HOME`
      override, so the guard should never fire for them — confirmed by
      re-reading each convention in the design doc's investigation, but the
      full suite run is the real proof). If anything newly fails, that is
      the signal to look at — do not silence the guard to make it pass.

## Task 3 — RED: failing tests for the GOALS.md importer

File: `src/lib/goals/import-from-persona.ts` does not exist yet — write
the test first against the intended API.

File: `src/lib/goals/import-from-persona.test.ts` (new)

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-goals-import-test-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { listGoals } = await import("./store");
const { parseGoalsMdBullets, importGoalsFromPersonaFile } = await import("./import-from-persona");

_resetDbForTests();
getDb();

test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

test("parseGoalsMdBullets: extracts title text from dated bullets, ignores headers/prose", () => {
  const content = [
    "# GOALS — what the operator is working toward",
    "",
    "Maintained by the agent from real conversations. Edit freely.",
    "",
    "## Active goals",
    "- 2026-07-07: Tracking progress on 'Solar Solo Founder' weekly goals.",
    "- 2026-07-13: Gym 4x/week",
    "",
  ].join("\n");
  assert.deepEqual(parseGoalsMdBullets(content), [
    "Tracking progress on 'Solar Solo Founder' weekly goals.",
    "Gym 4x/week",
  ]);
});

test("parseGoalsMdBullets: dedupes exact-duplicate lines, keeps first occurrence order", () => {
  const content = ["- 2026-07-13: Gym 4x/week", "- 2026-07-14: Gym 4x/week"].join("\n");
  assert.deepEqual(parseGoalsMdBullets(content), ["Gym 4x/week"]);
});

test("parseGoalsMdBullets: empty/whitespace-only content yields no goals", () => {
  assert.deepEqual(parseGoalsMdBullets(""), []);
  assert.deepEqual(parseGoalsMdBullets("# GOALS\n\nNo bullets here.\n"), []);
});

test("importGoalsFromPersonaFile: inserts each parsed bullet as an active goal", () => {
  const file = join(TMP, "GOALS.md");
  writeFileSync(file, "- 2026-07-13: Land Engine 1 — first fractional AI retainer\n- 2026-07-13: Gym 4x/week\n");

  const result = importGoalsFromPersonaFile(file);
  assert.equal(result.imported, 2);
  assert.equal(result.skipped, 0);

  const titles = listGoals().map((g) => g.title).sort();
  assert.deepEqual(titles, ["Gym 4x/week", "Land Engine 1 — first fractional AI retainer"]);
});

test("importGoalsFromPersonaFile: skips a bullet whose title already exists (case-insensitive)", () => {
  const file = join(TMP, "GOALS2.md");
  writeFileSync(file, "- 2026-07-13: gym 4x/week\n- 2026-07-13: Brand new goal not seen before\n");

  const before = listGoals().length;
  const result = importGoalsFromPersonaFile(file);
  assert.equal(result.imported, 1); // only the brand-new one
  assert.equal(result.skipped, 1); // "gym 4x/week" already exists from the prior test
  assert.equal(listGoals().length, before + 1);
});

test("importGoalsFromPersonaFile: missing file returns a zero result instead of throwing", () => {
  const result = importGoalsFromPersonaFile(join(TMP, "does-not-exist.md"));
  assert.deepEqual(result, { imported: 0, skipped: 0, goals: [] });
});
```

- [ ] Write the test file above. Run
      `npx tsx --test src/lib/goals/import-from-persona.test.ts` and confirm
      it fails to even run (module `./import-from-persona` doesn't exist) —
      that's the RED state.

## Task 4 — GREEN: implement the importer

File: `src/lib/goals/import-from-persona.ts` (new)

```ts
/**
 * Startup self-heal: if the structured goals store is empty, seed it from
 * persona/GOALS.md (the operator's free-form, agent-maintained goal ledger)
 * so an empty Goals panel never silently breaks daily_review/goal_checkin/
 * weaver-daily-audit. Deterministic and dependency-free by design — no model
 * call, so it can run unattended at daemon boot. The richer, judgment-based
 * import ("merge these three paraphrases of the same goal") stays a chat-tool
 * job; see docs/superpowers/specs/2026-07-15-goals-data-loss-design.md §2.2.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { listGoals, upsertGoal, type Goal } from "./store";
import { configuredBrainRootDir } from "@/lib/brain/settings";

const BULLET_RE = /^-\s*\d{4}-\d{2}-\d{2}:\s*(.+?)\s*$/;

/** Pure: extract goal title text from GOALS.md's `- YYYY-MM-DD: <text>` bullets. */
export function parseGoalsMdBullets(content: string): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const line of content.split("\n")) {
    const match = BULLET_RE.exec(line);
    if (!match) continue;
    const title = match[1];
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
  }
  return titles;
}

export interface ImportGoalsResult {
  imported: number;
  skipped: number;
  goals: Goal[];
}

/** Import every not-yet-present bullet from a GOALS.md file into the goals store. */
export function importGoalsFromPersonaFile(filePath: string): ImportGoalsResult {
  if (!existsSync(filePath)) return { imported: 0, skipped: 0, goals: [] };

  const titles = parseGoalsMdBullets(readFileSync(filePath, "utf8"));
  const existing = new Set(listGoals().map((g) => g.title.toLowerCase()));

  const goals: Goal[] = [];
  let imported = 0;
  let skipped = 0;
  for (const title of titles) {
    if (existing.has(title.toLowerCase())) { skipped++; continue; }
    goals.push(upsertGoal({ title }));
    existing.add(title.toLowerCase());
    imported++;
  }
  return { imported, skipped, goals };
}

/** Startup hook: only imports when the store is genuinely empty. No-op otherwise. */
export function importGoalsFromPersonaIfEmpty(): ImportGoalsResult | null {
  if (listGoals().length > 0) return null;
  const root = configuredBrainRootDir();
  if (!root) return null;
  const path = join(root, "persona", "GOALS.md");
  if (!existsSync(path)) return null;
  return importGoalsFromPersonaFile(path);
}
```

- [ ] Write the file above.
- [ ] Run `npx tsx --test src/lib/goals/import-from-persona.test.ts` — all
      tests pass (GREEN).
- [ ] Run `npm run typecheck` — zero errors (confirms the `Goal`/`store.ts`
      import types line up).

## Task 5 — wire the startup self-heal into the daemon

File: `src/daemon/index.ts` — add immediately after the existing
"Self-heal: revive any recurring directive…" block (current lines 106–113),
matching its exact shape (try/catch, log-and-continue, never fail boot):

```ts
  // Self-heal: if the structured goals store is empty (e.g. after the
  // 2026-07-14 test-DB-isolation incident wiped it — see
  // docs/superpowers/specs/2026-07-15-goals-data-loss-design.md), seed it
  // from persona/GOALS.md so the Goals panel and the accountability loop
  // (daily_review/goal_checkin/weaver-daily-audit) never see a silent
  // "no goals yet" dead end. No-ops once any goal exists.
  try {
    const { importGoalsFromPersonaIfEmpty } = await import("@/lib/goals/import-from-persona");
    const result = importGoalsFromPersonaIfEmpty();
    if (result) console.log(`[goals] imported ${result.imported} goal(s) from GOALS.md (${result.skipped} already present)`);
  } catch (e) { console.error("[goals] persona import-on-boot failed:", e instanceof Error ? e.message : e); }
```

- [ ] Make the edit above (do not touch anything else in this file — it has
      an unrelated concurrent task's uncommitted changes in the primary
      worktree; this worktree's copy is clean at HEAD, keep the diff to
      exactly this block).
- [ ] Run `npm run typecheck` — zero errors.

## Task 6 — verification gates

- [ ] `npm run typecheck` — zero errors.
- [ ] `npm test` — all pass, including the new files from Tasks 1 and 3.
- [ ] `node scripts/scope-wall.mjs` — zero violations (this change adds no
      new persistent store/orchestration primitive — `import-from-persona.ts`
      is a plain function module over the existing `goals` table, so this
      should pass without a DECISIONS.md entry; if scope-wall disagrees,
      stop and re-read what it's flagging rather than overriding it).

## Task 7 — run the import once against the live DB

The startup hook only fires on the *next* daemon restart. The operator's
Goals panel should not have to wait for that. After Tasks 1–6 are verified
green, run the same import function once, directly, against the real
`~/.hivematrix/hivematrix.db` (not a test DB) to populate it immediately:

```
cd .claude/worktrees/fix-goals-data-loss
npx tsx -e '
import { importGoalsFromPersonaIfEmpty } from "./src/lib/goals/import-from-persona.ts";
const result = importGoalsFromPersonaIfEmpty();
console.log(JSON.stringify(result, null, 2));
'
```

- [ ] Run the command above (no `HIVEMATRIX_DB_PATH` override — this is the
      one intentional write to the real production DB in this whole plan).
- [ ] Confirm via `sqlite3 ~/.hivematrix/hivematrix.db "SELECT title FROM goals;"`
      that the imported titles look right and match GOALS.md's bullets.

## Task 8 — finish (per AGENTS.md finishing-a-development-branch; do NOT release)

- [ ] Commit all changes on `fix/goals-data-loss-db-test-isolation` with a
      clear message referencing the design doc.
- [ ] Do **not** merge into `main` from this worktree: the primary working
      tree currently has unrelated uncommitted changes from a concurrent
      self-improvement task (iMessage share-progress feature) with `main`
      checked out. Forcing the `main` ref forward while that worktree has
      dirty state checked out risks confusing that in-progress session. Leave
      the branch committed and ready-to-merge; report its name and HEAD sha
      so the operator (or a later run, once the primary worktree is clean)
      can fast-forward-merge it.
- [ ] Do **not** run `npm run release` / the release-hivematrix skill — the
      operator releases.
- [ ] Final report to the operator covers: root cause (test suite wiped the
      live DB, not a migration/cache/import bug), the fix (fail-closed guard
      + goals self-heal), that goals are already restored in the live DB via
      Task 7, the full undisclosed blast radius from §1.1 of the design doc
      (tasks/flash_turns/feedback/directives/work_packages also wiped, backup
      preserved at `~/.hivematrix/backups/hivematrix-preupdate-2026-07-13T09-58-12-356Z.db`
      if the operator wants to recover any of it), and the two explicitly
      out-of-scope follow-ups (GOALS.md's own duplicate-accumulation bug in
      `distill.ts`; an updater-level "did an update silently wipe data"
      self-check).
