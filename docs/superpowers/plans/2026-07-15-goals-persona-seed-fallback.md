# GOALS.md Persona Seed Fallback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-07-15-goals-persona-seed-fallback-design.md`

Two files touched (`src/daemon/index.ts`) plus one new module + one new test
file — one task, one subagent.

## Task 1 — Add `parseGoalTitlesFromGoalsMd` + `seedGoalsFromPersonaIfEmpty`, wire into daemon boot

Files:
- New: `src/lib/goals/persona-seed.ts`
- New: `src/lib/goals/persona-seed.test.ts`
- Edit: `src/daemon/index.ts` (after the existing self-heal `try/catch` block, ~line 84)

### Reused (do not reimplement)

- `parseSectionBullets` from `@/lib/brain/persona-section` — the existing,
  already-tested, already-production-used (`voice/command-turn.ts`'s
  `readSpokenGoals`) pure parser for "GOALS.md content → flat goal-title
  list, date-prefix stripped."
- `configuredBrainRootDir` from `@/lib/brain/settings` — the shared brain-root
  resolver every other GOALS.md reader uses.
- `upsertGoal`, `listGoals` from `@/lib/goals/store` — id/timestamp/defaults
  handled internally; do not hand-write an INSERT.
- `_resetDbForTests` from `@/lib/db` — test-only DB singleton reset, same
  tool `messagebee/store.test.ts` already uses for per-test isolation.

- [ ] **Red:** Create `src/lib/goals/persona-seed.test.ts`:

  ```ts
  import test from "node:test";
  import assert from "node:assert/strict";
  import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
  import { join } from "node:path";
  import { tmpdir } from "node:os";

  // Several cases below hinge on the `goals` table being genuinely empty vs.
  // non-empty at the moment seedGoalsFromPersonaIfEmpty runs (e.g. a missing
  // GOALS.md file must no-op FOR THAT REASON, not because a prior test in
  // this file already left rows behind) — so, unlike goals/store.test.ts's
  // single-shared-DB-for-the-whole-file style, this follows
  // messagebee/store.test.ts's _resetDbForTests() + HIVEMATRIX_DB_PATH
  // convention to get a fresh, empty DB file before every DB-touching test.
  const { _resetDbForTests } = await import("@/lib/db");
  const { listGoals, upsertGoal } = await import("@/lib/goals/store");
  const { parseGoalTitlesFromGoalsMd, seedGoalsFromPersonaIfEmpty } = await import("./persona-seed");

  const cleanupDirs: string[] = [];

  /** Point the DB singleton at a fresh, empty temp file. Call at the start
   * of every test that touches the `goals` table. */
  function freshDb(): void {
    const dir = mkdtempSync(join(tmpdir(), "hm-goals-persona-seed-db-"));
    cleanupDirs.push(dir);
    process.env.HIVEMATRIX_DB_PATH = join(dir, "test.db");
    _resetDbForTests();
  }

  function freshBrainRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), "hm-goals-persona-seed-brain-"));
    cleanupDirs.push(dir);
    return dir;
  }

  function writeGoalsMd(brainRoot: string, content: string): void {
    const dir = join(brainRoot, "persona");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "GOALS.md"), content, "utf-8");
  }

  test.after(() => {
    _resetDbForTests();
    delete process.env.HIVEMATRIX_DB_PATH;
    for (const d of cleanupDirs) rmSync(d, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------
  // parseGoalTitlesFromGoalsMd — pure, no DB/filesystem
  // ---------------------------------------------------------------------

  test("parseGoalTitlesFromGoalsMd: normal multi-bullet file under the Active goals header", () => {
    const content = [
      "# GOALS — what the operator is working toward",
      "",
      "Maintained by the agent from real conversations.",
      "",
      "## Active goals",
      "- 2026-07-07: Tracking progress on 'Solar Solo Founder' weekly goals.",
      "- 2026-07-10: Obtain accurate historical info about Oracle XStore.",
      "- 2026-07-12: Reach $500K ARR by Q4 2027 across three monetization engines",
      "",
    ].join("\n");
    assert.deepEqual(parseGoalTitlesFromGoalsMd(content), [
      "Tracking progress on 'Solar Solo Founder' weekly goals.",
      "Obtain accurate historical info about Oracle XStore.",
      "Reach $500K ARR by Q4 2027 across three monetization engines",
    ]);
  });

  test("parseGoalTitlesFromGoalsMd: no '## Active goals' header and no bullet lines returns no goals", () => {
    const content = "# Some other doc\n\nNo header here, just prose.\n";
    assert.deepEqual(parseGoalTitlesFromGoalsMd(content), []);
  });

  test("parseGoalTitlesFromGoalsMd: is header-agnostic (matches command-turn.ts's readSpokenGoals precedent) — a bullet is still found with no '## Active goals' header present at all", () => {
    const content = "# A doc with no Active-goals header\n- 2026-07-01: A bullet with no header above it\n";
    assert.deepEqual(parseGoalTitlesFromGoalsMd(content), ["A bullet with no header above it"]);
  });

  test("parseGoalTitlesFromGoalsMd: empty file returns no goals", () => {
    assert.deepEqual(parseGoalTitlesFromGoalsMd(""), []);
  });

  test("parseGoalTitlesFromGoalsMd: bullets without a date prefix are kept as-is", () => {
    const content = "## Active goals\n- Learn Italian\n- 2026-07-01: Run a 5k\n";
    assert.deepEqual(parseGoalTitlesFromGoalsMd(content), ["Learn Italian", "Run a 5k"]);
  });

  test("parseGoalTitlesFromGoalsMd: non-bullet prose lines mixed in are ignored", () => {
    const content = [
      "## Active goals",
      "Some free-text note the operator left here.",
      "- 2026-07-01: Real goal one",
      "Another stray sentence.",
      "- 2026-07-02: Real goal two",
    ].join("\n");
    assert.deepEqual(parseGoalTitlesFromGoalsMd(content), ["Real goal one", "Real goal two"]);
  });

  test("parseGoalTitlesFromGoalsMd: leading/trailing whitespace around a bullet is trimmed", () => {
    const content = "## Active goals\n   -    2026-07-01:   Goal with padding   \n";
    assert.deepEqual(parseGoalTitlesFromGoalsMd(content), ["Goal with padding"]);
  });

  // ---------------------------------------------------------------------
  // seedGoalsFromPersonaIfEmpty — temp-DB + temp-brain-root integration
  // ---------------------------------------------------------------------

  test("seedGoalsFromPersonaIfEmpty: seeds from GOALS.md when goals table is empty", () => {
    freshDb();
    const brainRoot = freshBrainRoot();
    writeGoalsMd(brainRoot, [
      "## Active goals",
      "- 2026-07-07: First goal",
      "- 2026-07-10: Second goal",
    ].join("\n"));

    assert.equal(listGoals().length, 0, "sanity: table starts empty");
    const result = seedGoalsFromPersonaIfEmpty(brainRoot);

    assert.equal(result.seeded, 2);
    const goals = listGoals();
    assert.equal(goals.length, 2);
    assert.deepEqual(goals.map((g) => g.title), ["First goal", "Second goal"], "preserves GOALS.md order via sortOrder");
    assert.ok(goals.every((g) => g.cadence === "milestone" && g.status === "active"));
  });

  test("seedGoalsFromPersonaIfEmpty: does not fire or duplicate when goals already has rows", () => {
    freshDb();
    const brainRoot = freshBrainRoot();
    writeGoalsMd(brainRoot, "## Active goals\n- 2026-07-07: Should not be imported\n");
    upsertGoal({ title: "Pre-existing operator goal" });

    const result = seedGoalsFromPersonaIfEmpty(brainRoot);

    assert.equal(result.seeded, 0);
    const goals = listGoals();
    assert.equal(goals.length, 1, "no rows added");
    assert.equal(goals[0].title, "Pre-existing operator goal");
  });

  test("seedGoalsFromPersonaIfEmpty: missing GOALS.md file is a no-op, never throws", () => {
    freshDb();
    const brainRoot = freshBrainRoot(); // no persona/GOALS.md written
    assert.doesNotThrow(() => {
      const result = seedGoalsFromPersonaIfEmpty(brainRoot);
      assert.equal(result.seeded, 0);
    });
    assert.equal(listGoals().length, 0);
  });

  test("seedGoalsFromPersonaIfEmpty: null brain root (memory disabled) is a no-op, never throws", () => {
    freshDb();
    assert.doesNotThrow(() => {
      const result = seedGoalsFromPersonaIfEmpty(null);
      assert.equal(result.seeded, 0);
    });
    assert.equal(listGoals().length, 0);
  });
  ```

  Run `npm test -- --test-name-pattern persona-seed` (or the full `npm test`)
  and confirm this fails with a module-not-found error on
  `await import("./persona-seed")` — proving red for the right reason (the
  implementation doesn't exist yet), not a typo in the test file itself.

- [ ] **Green:** Create `src/lib/goals/persona-seed.ts`:

  ```ts
  /**
   * Last-resort fallback: seed the `goals` table from the operator's
   * persona/GOALS.md when the table is empty and self-heal
   * (db/self-heal.ts's healEmptiedTables) found no backup with usable rows
   * either — e.g. a fresh machine's first run, or every backup happens to
   * also be hollowed out.
   *
   * Additive-only and one-shot: only ever acts when `goals` is genuinely
   * empty, the same "empty == data loss, non-empty == leave alone" contract
   * self-heal already uses. Never overwrites, never fires again once the
   * operator has any goal row (including one they later deliberately
   * delete). Best-effort: a missing/unreadable GOALS.md or a dehydrating
   * Drive mount must never crash boot (mirrors flash/distill.ts's
   * learnIntoPersonaFile `catch { return 0 }` pattern).
   */

  import { existsSync, readFileSync } from "fs";
  import { join } from "path";

  import { parseSectionBullets } from "@/lib/brain/persona-section";
  import { configuredBrainRootDir } from "@/lib/brain/settings";
  import { listGoals, upsertGoal } from "@/lib/goals/store";

  /**
   * Goal titles found in GOALS.md content — a thin, named, tested pass-
   * through to persona-section.ts's parseSectionBullets (the existing
   * read-side companion to GOALS_SECTION_SPEC's write side, already used on
   * this exact file by voice/command-turn.ts's readSpokenGoals). Kept as
   * its own seam here so a future change to that shared parser's contract
   * is caught by this feature's own tests, not just discovered at runtime.
   * Header-agnostic like its precedent: a bullet is picked up wherever it
   * appears in the file, not only under "## Active goals".
   */
  export function parseGoalTitlesFromGoalsMd(content: string): string[] {
    return parseSectionBullets(content);
  }

  export interface SeedGoalsResult {
    /** Number of goal rows created. 0 means "no-op" for any reason (table
     * already had rows, no brain root, no GOALS.md file, or a failure). */
    seeded: number;
  }

  /**
   * Seed `goals` from persona/GOALS.md, but only if the table is currently
   * empty. Safe to call unconditionally on every boot (mirrors
   * healEmptiedTables's own self-contained emptiness check) — a non-empty
   * table, including one the operator has deliberately emptied back out
   * after deleting a seeded goal, is left untouched.
   *
   * `brainRoot` is an optional override (tests only); production omits it
   * and falls back to configuredBrainRootDir(), matching flash/distill.ts's
   * distillSession(sessionId, brainRoot?, ...) convention. Pass `null`
   * explicitly to simulate memory/brain being disabled.
   */
  export function seedGoalsFromPersonaIfEmpty(brainRoot?: string | null): SeedGoalsResult {
    try {
      if (listGoals().length > 0) return { seeded: 0 };

      const root = brainRoot !== undefined ? brainRoot : configuredBrainRootDir();
      if (!root) return { seeded: 0 };

      const path = join(root, "persona", "GOALS.md");
      if (!existsSync(path)) return { seeded: 0 };

      const content = readFileSync(path, "utf-8");
      const titles = parseGoalTitlesFromGoalsMd(content);

      let seeded = 0;
      titles.forEach((title, i) => {
        try {
          upsertGoal({ title, cadence: "milestone", status: "active", sortOrder: i });
          seeded++;
        } catch {
          // Skip this one title; don't lose credit for the others already seeded.
        }
      });

      return { seeded };
    } catch {
      return { seeded: 0 }; // best-effort; brain root may be an unmounted/dehydrating Drive
    }
  }
  ```

  Run `npm test` again (or scoped to this file) and confirm all new tests
  pass.

- [ ] **Wire into daemon boot.** In `src/daemon/index.ts`, immediately after
  the existing self-heal `try { ... } catch (e) { console.error("[self-heal]
  failed:", ...); }` block (and before the `// Initialize connectivity
  policy (singleton)` comment), add:

  ```ts
    // Last-resort fallback: healEmptiedTables() above may still leave `goals`
    // empty (fresh machine's first run, or every backup also hollowed out).
    // If so, seed it from the operator's persona/GOALS.md — additive-only,
    // one-shot (only ever acts on a genuinely empty table, same contract as
    // the self-heal block above), never fatal. See lib/goals/persona-seed.ts.
    try {
      const { seedGoalsFromPersonaIfEmpty } = await import("@/lib/goals/persona-seed");
      const { seeded } = seedGoalsFromPersonaIfEmpty();
      if (seeded > 0) {
        console.warn(`[goals:persona-seed] seeded ${seeded} goal(s) from persona/GOALS.md (goals table was empty)`);
      }
    } catch (e) {
      console.error("[goals:persona-seed] failed:", e instanceof Error ? e.message : e);
    }
  ```

  This is a boot-sequence entrypoint edit only (no exported logic of its
  own) — there is no `daemon/index.test.ts` in this repo to update; the
  behavior is covered by `persona-seed.test.ts` plus this block's shape
  being a direct copy of the already-shipped, already-soaked self-heal block
  immediately above it.

- [ ] Re-run the full verification gate (below). Confirm no other test file
  regresses — in particular `src/lib/goals/store.test.ts` and
  `src/lib/db/self-heal.test.ts`, since this touches the same table/module
  neighborhood but should require zero changes to either.

## Verification gate (per AGENTS.md)

```
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

`qwen-readiness.mts` not required — this touches `src/lib/goals/` and
`src/daemon/index.ts`, not `src/lib/local-model/`, `qwen-profile.ts`, or
`models/backends.ts`.

No live "install an update, then confirm goals are present" run is possible
in this non-interactive session (no packaging/release step — this loop's
hard boundary is fix-and-commit only, the operator releases). Verification
relies on: the pure-function unit tests proving the parse contract exactly
matches `GOALS_SECTION_SPEC`/`mergeDatedSection`'s write side, the temp-DB
integration tests proving the empty/non-empty gating and per-title defaults,
and the daemon-side block being shape-for-shape identical to the
already-shipped, already-soaked self-heal block it sits beside. State this
limitation explicitly when reporting completion.

## Out of scope / explicitly not touched

- `src/lib/db/self-heal.ts` and its test file — already correct, unchanged.
- The conversational/on-demand "import from GOALS.md" tool path
  (`goal_upsert` / `CAPABILITY_DOCTRINE`) — different trigger, different
  code path.
- No new persistent store, table, or column.
- No release/build/publish step. Operator releases.
