import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-terminal-lane-store-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const {
  getTerminalLaneReadinessDashboard,
  listTerminalProfileSummaries,
  listTerminalProfiles,
  recordTerminalReadinessRun,
  upsertTerminalProfile,
  upsertTerminalReadinessProbe,
  listEnabledTerminalReadinessProbes,
  recordTerminalSessionAudit,
  listTerminalSessionAudit,
} = await import("./store");

before(() => {
  _resetDbForTests();
  getDb();
});

beforeEach(() => {
  getDb().exec(`
    DELETE FROM terminal_session_audit;
    DELETE FROM terminal_readiness_runs;
    DELETE FROM terminal_readiness_probes;
    DELETE FROM terminal_credentials;
    DELETE FROM terminal_profiles;
  `);
});

after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

test("terminal store upserts profiles with credential refs but no secret values", () => {
  const profile = upsertTerminalProfile({
    id: "prod",
    displayName: "Production",
    kind: "ssh",
    host: "prod.example",
    user: "deploy",
    credentialRef: "hivematrix.terminal.prod.primary",
  });

  assert.equal(profile.openCommand, "ssh deploy@prod.example");
  const profiles = listTerminalProfiles();
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].credentialRef, "hivematrix.terminal.prod.primary");

  const row = getDb().prepare("SELECT * FROM terminal_credentials WHERE profileId = ?").get("prod") as Record<string, unknown>;
  assert.equal(row.credentialRef, "hivematrix.terminal.prod.primary");
  assert.equal("password" in row, false);
  assert.equal("secret" in row, false);
});

test("terminal store records probes, readiness, dashboard, and audit without secrets", () => {
  upsertTerminalProfile({
    id: "prod",
    displayName: "Production",
    kind: "ssh",
    host: "prod.example",
    user: "deploy",
    credentialRef: "hivematrix.terminal.prod.primary",
  });
  upsertTerminalReadinessProbe({ id: "prod-login", profileId: "prod", name: "SSH login" });
  assert.equal(listEnabledTerminalReadinessProbes("prod").length, 1);

  const run = recordTerminalReadinessRun({
    profileId: "prod",
    probeId: "prod-login",
    status: "needs_auth",
    summary: "Permission denied",
    metadata: { password: "nope", safe: "visible" },
  });
  assert.equal(run.color, "orange");

  recordTerminalSessionAudit({
    profileId: "prod",
    sessionId: "term-prod",
    event: "command",
    command: "echo hello",
    metadata: { token: "abc123", safe: true },
  });

  const dashboard = getTerminalLaneReadinessDashboard();
  assert.equal(dashboard.lane, "terminal");
  assert.equal(dashboard.totals.profiles, 1);
  assert.equal(dashboard.totals.byColor.orange, 1);
  assert.equal(dashboard.profiles[0].readiness.status, "needs_auth");
  assert.equal(dashboard.profiles[0].credentialRef, "hivematrix.terminal.prod.primary");
  assert.equal("password" in dashboard.profiles[0], false);

  const audit = listTerminalSessionAudit();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].metadata.token, "[redacted]");

  const summaries = listTerminalProfileSummaries();
  assert.equal(summaries[0].probeCount, 1);
});
