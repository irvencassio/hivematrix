import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-heygen-workflow-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { seedHeyGenBrowserSite } = await import("@/lib/browser-lane/heygen");
const { recordBrowserReadinessRun } = await import("@/lib/browser-lane/store");
const { dispatchHeyGenVideoWorkflow } = await import("./heygen-workflow");

before(() => { _resetDbForTests(); getDb(); });
after(() => { _resetDbForTests(); delete process.env.HIVEMATRIX_DB_PATH; rmSync(TMP, { recursive: true, force: true }); });
beforeEach(() => {
  getDb().exec("DELETE FROM browser_sites; DELETE FROM browser_credentials; DELETE FROM browser_readiness_probes; DELETE FROM browser_readiness_runs; DELETE FROM coo_routing_rules; DELETE FROM coo_routing_rule_history; DELETE FROM coo_dispatch_audit;");
  seedHeyGenBrowserSite();
});

function setReadiness(status: string, color: string) {
  recordBrowserReadinessRun({ siteId: "heygen", status: status as never, color: color as never, summary: status, traceRunId: "trace-heygen" });
}
function backdate() {
  getDb().prepare("UPDATE browser_readiness_runs SET startedAt = '2020-01-01 00:00:00' WHERE siteId = 'heygen'").run();
}

const INPUT = { script: "The founder speaks about the launch and the road ahead.", title: "Launch" };

test("create succeeds when HeyGen readiness is green and fresh, building the rich envelope", async () => {
  setReadiness("ready", "green");
  const persisted: Array<{ requiresLogin: boolean; blob: string }> = [];
  const result = await dispatchHeyGenVideoWorkflow(INPUT, {
    create: true, projectPath: "/Users/test/proj", browserAvailable: true, staleAfterHours: 24,
    persistTask: async ({ envelope }) => { persisted.push({ requiresLogin: envelope.requiresLogin, blob: JSON.stringify(envelope) }); return { id: "task_heygen_1" }; },
  });
  assert.equal(result.status, "created");
  assert.equal(result.taskId, "task_heygen_1");
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].requiresLogin, true);
  // The created envelope is the HeyGen job; the system injects no credential
  // material (no credentialRef pointer, cookies, passwords, or tokens).
  assert.doesNotMatch(persisted[0].blob, /credentialRef|cookie|password|\btoken\b|keychain/i);
  assert.match(persisted[0].blob, /founder speaks/); // the script content is carried
  assert.ok(result.job, "the workflow returns the built job");
});

test("create is blocked (readiness_required) when HeyGen needs reauth", async () => {
  setReadiness("needs_reauth", "orange");
  let called = 0;
  const result = await dispatchHeyGenVideoWorkflow(INPUT, {
    create: true, projectPath: "/Users/test/proj", browserAvailable: true, staleAfterHours: 24,
    persistTask: async () => { called += 1; return { id: "no" }; },
  });
  assert.equal(result.status, "readiness_required");
  assert.equal(result.taskId, null);
  assert.equal(called, 0);
});

test("create is blocked when HeyGen readiness is green but STALE", async () => {
  setReadiness("ready", "green");
  backdate();
  let called = 0;
  const result = await dispatchHeyGenVideoWorkflow(INPUT, {
    create: true, projectPath: "/Users/test/proj", browserAvailable: true, staleAfterHours: 24,
    persistTask: async () => { called += 1; return { id: "no" }; },
  });
  assert.equal(result.status, "readiness_required");
  assert.equal(called, 0);
});

test("create is blocked when HeyGen has no readiness run yet (gray/unknown)", async () => {
  // no setReadiness → no run → gray
  let called = 0;
  const result = await dispatchHeyGenVideoWorkflow(INPUT, {
    create: true, projectPath: "/Users/test/proj", browserAvailable: true, staleAfterHours: 24,
    persistTask: async () => { called += 1; return { id: "no" }; },
  });
  assert.equal(result.status, "readiness_required");
  assert.equal(called, 0);
});

test("prepare-only routes to the Browser Lane and returns readiness + the job (no task)", async () => {
  setReadiness("ready", "green");
  const result = await dispatchHeyGenVideoWorkflow(INPUT, { staleAfterHours: 24 });
  assert.equal(result.lane, "browser");
  assert.equal(result.status, "prepared");
  assert.equal(result.taskId, null);
  assert.ok(result.readiness?.matched);
  assert.ok(result.job);
  // The audited/routed text is the objective, not the raw script body.
  const audit = getDb().prepare("SELECT requestText FROM coo_dispatch_audit ORDER BY rowid DESC LIMIT 1").get() as { requestText: string };
  assert.match(audit.requestText, /HeyGen/);
  assert.doesNotMatch(audit.requestText, /founder speaks/);
});
