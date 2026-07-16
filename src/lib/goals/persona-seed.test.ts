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
