import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-browser-lane-db-"));
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

test("browser lane and COO routing schema exists", () => {
  const tables = tableNames();
  for (const table of [
    "lane_providers",
    "lane_capabilities",
    "coo_routing_rules",
    "coo_routing_rule_history",
    "browser_sites",
    "browser_credentials",
    "browser_readiness_probes",
    "browser_readiness_runs",
    "browser_trace_runs",
    "browser_trace_events",
  ]) {
    assert.ok(tables.includes(table), `${table} table should exist`);
  }
});

test("browser_credentials stores references, not secret values", () => {
  const columns = columnNames("browser_credentials");
  assert.ok(columns.includes("credentialRef"));
  assert.ok(columns.includes("siteId"));
  assert.equal(columns.includes("password"), false);
  assert.equal(columns.includes("secret"), false);
  assert.equal(columns.includes("token"), false);
});
