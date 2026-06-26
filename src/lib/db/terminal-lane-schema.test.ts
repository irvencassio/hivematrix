import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-terminal-lane-schema-"));
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

function columns(table: string): string[] {
  return (getDb().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
}

test("Terminal Lane setup tables exist with no secret columns", () => {
  for (const table of [
    "terminal_profiles",
    "terminal_credentials",
    "terminal_readiness_probes",
    "terminal_readiness_runs",
    "terminal_session_audit",
  ]) {
    const cols = columns(table);
    assert.ok(cols.length > 0, `${table} should exist`);
    assert.equal(cols.some((c) => /password|passphrase|private.?key|secret|token|cookie/i.test(c)), false, `${table} must not persist secrets`);
  }
});

test("terminal_profiles carries profile metadata and credentialRef only", () => {
  const cols = columns("terminal_profiles");
  for (const required of ["_id", "displayName", "kind", "host", "user", "port", "shell", "cwd", "credentialRef", "openCommand", "status"]) {
    assert.ok(cols.includes(required), `terminal_profiles.${required} should exist`);
  }
});
