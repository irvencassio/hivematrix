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
  getTerminalProfile,
  deleteTerminalProfile,
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

test("upsert persists authMethod + keyPath and preserves createdAt on update", () => {
  const created = upsertTerminalProfile({
    id: "kf", displayName: "Key File", authMethod: "ssh_key_file", host: "h.example", user: "u", keyPath: "/Users/me/.ssh/id_ed25519",
  });
  assert.equal(created.authMethod, "ssh_key_file");
  assert.equal(created.keyPath, "/Users/me/.ssh/id_ed25519");
  const firstCreatedAt = created.createdAt;

  const updated = upsertTerminalProfile({ id: "kf", displayName: "Renamed", authMethod: "ssh_key_agent", host: "h.example", user: "u" });
  assert.equal(updated.displayName, "Renamed");
  assert.equal(updated.authMethod, "ssh_key_agent");
  assert.equal(updated.keyPath, null, "ssh_key_agent clears keyPath");
  assert.equal(updated.createdAt, firstCreatedAt, "createdAt preserved across update");
});

test("summaries expose authMethod + credentialPresent but never a secret value", () => {
  upsertTerminalProfile({ id: "pw", displayName: "PW", authMethod: "password_keychain", host: "h.example", user: "u", credentialRef: "hivematrix.terminal.pw" });
  const s = listTerminalProfileSummaries().find((x) => x.id === "pw")!;
  assert.equal(s.authMethod, "password_keychain");
  assert.equal(s.credentialPresent, true);
  assert.doesNotMatch(JSON.stringify(s), /password=|--password|"password":|privateKey|passphrase/i);
});

test("deleteTerminalProfile removes a profile and its rows, but refuses the local default", () => {
  upsertTerminalProfile({ id: "doomed", displayName: "Doomed", authMethod: "ssh_key_agent", host: "h.example", user: "u" });
  upsertTerminalReadinessProbe({ id: "doomed-login", profileId: "doomed", name: "login" });
  assert.equal(deleteTerminalProfile("doomed"), true);
  assert.equal(getTerminalProfile("doomed"), null);
  assert.equal(listEnabledTerminalReadinessProbes("doomed").length, 0);

  upsertTerminalProfile({ id: "local", displayName: "Local Mac", authMethod: "local", shell: "/bin/zsh" });
  assert.throws(() => deleteTerminalProfile("local"), /local default|cannot delete/i);
  assert.ok(getTerminalProfile("local"), "local default preserved");
});

test("accessMode persists through upsert and defaults to readwrite", () => {
  upsertTerminalProfile({ id: "ro", displayName: "RO", authMethod: "ssh_key_agent", host: "h.x", user: "u", accessMode: "readonly" });
  assert.equal(getTerminalProfile("ro")!.accessMode, "readonly");
  upsertTerminalProfile({ id: "rw", displayName: "RW", authMethod: "ssh_key_agent", host: "h.x", user: "u" });
  assert.equal(getTerminalProfile("rw")!.accessMode, "readwrite");
});

test("rowToProfile heals legacy rows whose kind and authMethod disagree", async () => {
  const { runTerminalReadinessProbe } = await import("./readiness");
  // Legacy corruption seen in the field: kind=ssh with authMethod=local and an
  // ssh openCommand. Written directly — upsert would reject it today.
  getDb().prepare(`
    INSERT INTO terminal_profiles (_id, displayName, kind, authMethod, host, user, port, shell, cwd, keyPath, credentialRef, openCommand, notes)
    VALUES ('legacy', 'Legacy', 'ssh', 'local', 'h.example', 'u', 22, NULL, NULL, NULL, NULL, 'ssh -p 22 u@h.example', '')
  `).run();

  const profile = listTerminalProfiles().find((p) => p.id === "legacy")!;
  assert.equal(profile.authMethod, "ssh_key_agent");
  // The healed profile must survive contract normalization (readiness re-normalizes).
  const result = await runTerminalReadinessProbe({
    profile,
    run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });
  assert.equal(result.state.status, "ready");
});
