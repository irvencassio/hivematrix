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
