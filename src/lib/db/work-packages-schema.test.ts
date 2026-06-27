import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-work-packages-db-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");

before(() => {
  _resetDbForTests();
  getDb();
});

after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

function tableNames(): string[] {
  return (getDb().prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
    .map((row) => row.name);
}

function columnNames(table: string): string[] {
  return (getDb().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((row) => row.name);
}

test("work_packages + work_package_items tables migrate", () => {
  const tables = tableNames();
  assert.ok(tables.includes("work_packages"), "work_packages table should exist");
  assert.ok(tables.includes("work_package_items"), "work_package_items table should exist");
});

test("work_packages has the designed columns", () => {
  const cols = columnNames("work_packages");
  for (const c of [
    "_id", "title", "description", "project", "projectPath", "status",
    "sourceTaskId", "modelPolicy", "orchestrationMode", "intake_json",
    "createdAt", "updatedAt", "completedAt",
  ]) {
    assert.ok(cols.includes(c), `work_packages.${c} should exist`);
  }
});

test("work_package_items has the designed columns", () => {
  const cols = columnNames("work_package_items");
  for (const c of [
    "_id", "packageId", "position", "title", "prompt", "status", "risk",
    "dependsOn", "scopeHints", "executionMode", "createdTaskId", "resultTaskId",
    "commitHash", "blocker", "createdAt", "updatedAt",
  ]) {
    assert.ok(cols.includes(c), `work_package_items.${c} should exist`);
  }
});
