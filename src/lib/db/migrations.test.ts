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
