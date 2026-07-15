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

test("restores message_identities from backup to recover sender allowlist after update", () => {
  const dir = tmpDir();
  try {
    // Create a backup with message_identities (simulating pre-update state).
    const backupDb = new Database(join(dir, "hivematrix-preupdate-2026-07-14T10-00-00-000Z.db"));
    backupDb.exec(
      "CREATE TABLE message_identities (" +
      "  _id TEXT PRIMARY KEY," +
      "  channel TEXT NOT NULL," +
      "  address TEXT NOT NULL," +
      "  displayName TEXT," +
      "  status TEXT NOT NULL DEFAULT 'pending'," +
      "  pairedAt TEXT" +
      ")",
    );
    const insertStmt = backupDb.prepare(
      "INSERT INTO message_identities (_id, channel, address, displayName, status, pairedAt) VALUES (?, ?, ?, ?, ?, ?)",
    );
    insertStmt.run("id1", "imessage", "+15551234567", "Alice", "allowed", "2026-07-14T10:00:00Z");
    insertStmt.run("id2", "imessage", "bob@example.com", "Bob", "paired", "2026-07-14T10:00:00Z");
    backupDb.close();

    // Create live DB with empty message_identities (simulating post-update wipe).
    const liveDb = new Database(":memory:");
    liveDb.exec(
      "CREATE TABLE message_identities (" +
      "  _id TEXT PRIMARY KEY," +
      "  channel TEXT NOT NULL," +
      "  address TEXT NOT NULL," +
      "  displayName TEXT," +
      "  status TEXT NOT NULL DEFAULT 'pending'," +
      "  pairedAt TEXT," +
      "  lastSeenAt TEXT" +
      ")",
    );

    // Heal should restore the identities from backup.
    const healed = healEmptiedTables({ db: liveDb, backupsDir: dir, tables: ["message_identities"] });

    assert.equal(healed.length, 1);
    assert.equal(healed[0].table, "message_identities");
    assert.equal(healed[0].restored, 2, "both identities restored");

    // Verify the restored rows.
    const rows = liveDb.prepare(
      "SELECT address, displayName, status FROM message_identities ORDER BY address",
    ).all() as Array<{ address: string; displayName: string | null; status: string }>;
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { address: "+15551234567", displayName: "Alice", status: "allowed" });
    assert.deepEqual(rows[1], { address: "bob@example.com", displayName: "Bob", status: "paired" });

    liveDb.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("simultaneously restores message_identities and goals from backup (multi-table heal)", () => {
  const dir = tmpDir();
  try {
    // Create a backup with both goals and message_identities.
    const backupDb = new Database(join(dir, "hivematrix-preupdate-2026-07-14T10-00-00-000Z.db"));
    backupDb.exec(
      "CREATE TABLE goals (id TEXT PRIMARY KEY, title TEXT NOT NULL);" +
      "CREATE TABLE message_identities (" +
      "  _id TEXT PRIMARY KEY," +
      "  channel TEXT NOT NULL," +
      "  address TEXT NOT NULL," +
      "  status TEXT NOT NULL" +
      ");",
    );
    backupDb.prepare("INSERT INTO goals (id, title) VALUES (?, ?)").run("goal1", "Important Goal");
    backupDb.prepare("INSERT INTO message_identities (_id, channel, address, status) VALUES (?, ?, ?, ?)")
      .run("id1", "imessage", "+15551234567", "allowed");
    backupDb.close();

    // Create live DB with both tables empty.
    const liveDb = new Database(":memory:");
    liveDb.exec(
      "CREATE TABLE goals (id TEXT PRIMARY KEY, title TEXT NOT NULL, nextAction TEXT);" +
      "CREATE TABLE message_identities (" +
      "  _id TEXT PRIMARY KEY," +
      "  channel TEXT NOT NULL," +
      "  address TEXT NOT NULL," +
      "  displayName TEXT," +
      "  status TEXT NOT NULL" +
      ");",
    );

    // Heal both tables in one call.
    const healed = healEmptiedTables({ db: liveDb, backupsDir: dir, tables: ["goals", "message_identities"] });

    assert.equal(healed.length, 2, "both tables healed");
    const tables = new Set(healed.map((h) => h.table));
    assert(tables.has("goals"), "goals restored");
    assert(tables.has("message_identities"), "message_identities restored");

    // Verify both were restored.
    const goalCount = (liveDb.prepare("SELECT count(*) AS c FROM goals").get() as { c: number }).c;
    const identityCount = (liveDb.prepare("SELECT count(*) AS c FROM message_identities").get() as { c: number }).c;
    assert.equal(goalCount, 1);
    assert.equal(identityCount, 1);

    liveDb.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
