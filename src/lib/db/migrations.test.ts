import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "./index";

test("a failing migration rolls back atomically: no half-applied schema, version unchanged", () => {
  const db = new Database(":memory:");
  const migrations = [
    "CREATE TABLE ok_one (x TEXT);",
    // Second statement fails — the CREATE before it must not survive.
    "CREATE TABLE half_applied (x TEXT); INSERT INTO does_not_exist VALUES (1);",
  ];

  assert.throws(() => runMigrations(db, migrations));

  assert.equal(db.pragma("user_version", { simple: true }), 1, "only the successful migration is recorded");
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((r) => r.name);
  assert.ok(tables.includes("ok_one"), "successful migration applied");
  assert.ok(!tables.includes("half_applied"), "failed migration must leave no partial schema");

  // Re-running after the failure is fixed resumes from the recorded version.
  const fixed = [migrations[0], "CREATE TABLE half_applied (x TEXT);"];
  runMigrations(db, fixed);
  assert.equal(db.pragma("user_version", { simple: true }), 2);
});

test("tracking is by id, not array position — a stale user_version can't skip a migration that never ran", () => {
  const db = new Database(":memory:");

  // Simulate a db whose user_version was advanced by a migration that ran
  // once (e.g. during local dev) and was never committed — the array below
  // never produced this version, yet the counter claims it did.
  db.exec("CREATE TABLE widgets (id TEXT PRIMARY KEY);");
  db.pragma("user_version = 1");

  const migrations = [{ id: "add-color-column", sql: "ALTER TABLE widgets ADD COLUMN color TEXT;" }];

  // The old array-length/user_version scheme would see currentVersion(1) >=
  // migrations.length(1) and skip this entirely, leaving `color` missing.
  runMigrations(db, migrations);

  const columns = (db.prepare("PRAGMA table_info(widgets)").all() as Array<{ name: string }>).map((c) => c.name);
  assert.ok(columns.includes("color"), "the migration must actually run even though user_version already claimed to cover it");
});

test("a migration whose column already exists outside the ledger is recorded, not treated as a failure", () => {
  const db = new Database(":memory:");

  // Simulate the column having been added by some out-of-band means (a prior
  // build's linear scheme, a manual hotfix) before the ledger ever ran.
  db.exec("CREATE TABLE widgets (id TEXT PRIMARY KEY, color TEXT);");

  const migrations = [{ id: "add-color-column", sql: "ALTER TABLE widgets ADD COLUMN color TEXT;" }];

  assert.doesNotThrow(() => runMigrations(db, migrations));
  const row = db.prepare("SELECT appliedAt FROM _migrations_applied WHERE id = ?").get("add-color-column") as { appliedAt: string } | undefined;
  assert.ok(row, "the migration is recorded in the ledger even though its SQL was a no-op here");
  assert.match(row!.appliedAt, /recovered/i);
});
