import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { healEmptiedTables } from "./self-heal";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "hivematrix-self-heal-"));
}

/** Write a backup DB file with a `goals` table holding the given titles. */
function writeBackup(dir: string, file: string, goals: string[], extraCol = false): void {
  const db = new Database(join(dir, file));
  db.exec(
    extraCol
      ? "CREATE TABLE goals (id TEXT PRIMARY KEY, title TEXT NOT NULL, legacyCol TEXT)"
      : "CREATE TABLE goals (id TEXT PRIMARY KEY, title TEXT NOT NULL)",
  );
  const stmt = extraCol
    ? db.prepare("INSERT INTO goals (id, title, legacyCol) VALUES (?, ?, 'x')")
    : db.prepare("INSERT INTO goals (id, title) VALUES (?, ?)");
  goals.forEach((t, i) => stmt.run(`g${i}`, t));
  db.close();
}

function liveDbWithEmptyGoals(): Database.Database {
  const db = new Database(":memory:");
  // Live schema has a NEW column the older backups lack — heal must map by shared cols.
  db.exec("CREATE TABLE goals (id TEXT PRIMARY KEY, title TEXT NOT NULL, nextAction TEXT)");
  return db;
}

test("restores rows into an empty table from the newest backup that has rows", () => {
  const dir = tmpDir();
  try {
    // Older backup has data; newest backup is empty (a post-wipe backup).
    writeBackup(dir, "hivematrix-preupdate-2026-07-13T09-58-12-356Z.db", ["Land Engine 1", "Gym 4x/week"]);
    writeBackup(dir, "hivematrix-preupdate-2026-07-15T02-08-21-554Z.db", []);

    const db = liveDbWithEmptyGoals();
    const healed = healEmptiedTables({ db, backupsDir: dir, tables: ["goals"] });

    assert.equal(healed.length, 1);
    assert.equal(healed[0].table, "goals");
    assert.equal(healed[0].restored, 2);
    assert.equal(healed[0].from, "hivematrix-preupdate-2026-07-13T09-58-12-356Z.db", "skips the empty newer backup");

    const titles = (db.prepare("SELECT title FROM goals ORDER BY id").all() as { title: string }[]).map((r) => r.title);
    assert.deepEqual(titles, ["Land Engine 1", "Gym 4x/week"]);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("does not touch a table that already has rows", () => {
  const dir = tmpDir();
  try {
    writeBackup(dir, "hivematrix-preupdate-2026-07-13T09-58-12-356Z.db", ["From Backup"]);
    const db = liveDbWithEmptyGoals();
    db.prepare("INSERT INTO goals (id, title) VALUES ('live1', 'Live Goal')").run();

    const healed = healEmptiedTables({ db, backupsDir: dir, tables: ["goals"] });

    assert.equal(healed.length, 0, "non-empty table is left alone");
    const titles = (db.prepare("SELECT title FROM goals").all() as { title: string }[]).map((r) => r.title);
    assert.deepEqual(titles, ["Live Goal"], "no backup rows merged in");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("maps by shared columns so backup schema drift is tolerated", () => {
  const dir = tmpDir();
  try {
    // Backup predates the `nextAction` column and has a since-removed `legacyCol`.
    writeBackup(dir, "hivematrix-preupdate-2026-07-10T00-00-00-000Z.db", ["Old Goal"], /* extraCol */ true);
    const db = liveDbWithEmptyGoals();

    const healed = healEmptiedTables({ db, backupsDir: dir, tables: ["goals"] });

    assert.equal(healed.length, 1);
    assert.equal(healed[0].restored, 1);
    const row = db.prepare("SELECT title, nextAction FROM goals").get() as { title: string; nextAction: string | null };
    assert.equal(row.title, "Old Goal");
    assert.equal(row.nextAction, null, "column absent in backup defaults to null");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no backups and corrupt backups are handled without throwing", () => {
  const dir = tmpDir();
  try {
    const db = liveDbWithEmptyGoals();
    // Empty dir → no-op.
    assert.deepEqual(healEmptiedTables({ db, backupsDir: dir, tables: ["goals"] }), []);

    // A non-DB file named like a backup must be skipped, not throw.
    writeFileSync(join(dir, "hivematrix-preupdate-garbage.db"), "not a sqlite file");
    assert.deepEqual(healEmptiedTables({ db, backupsDir: dir, tables: ["goals"] }), []);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ignores a table missing from the live DB", () => {
  const dir = tmpDir();
  try {
    writeBackup(dir, "hivematrix-preupdate-2026-07-13T09-58-12-356Z.db", ["X"]);
    const db = new Database(":memory:"); // no `goals` table at all
    const healed = healEmptiedTables({ db, backupsDir: dir, tables: ["goals"] });
    assert.deepEqual(healed, []);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
