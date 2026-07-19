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
