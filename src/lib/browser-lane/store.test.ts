import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-browser-lane-store-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const {
  listBrowserSites,
  listEnabledReadinessProbes,
  recordBrowserReadinessRun,
  upsertBrowserReadinessProbe,
  upsertBrowserSite,
  listBrowserSiteSummaries,
} = await import("./store");

before(() => {
  _resetDbForTests();
  getDb();
});

after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

test("browser lane store upserts sites with credential refs but no secret values", () => {
  upsertBrowserSite({
    id: "heygen",
    displayName: "HeyGen",
    homeUrl: "https://app.heygen.com/home",
    loginUrl: "https://app.heygen.com/login",
    allowedDomains: ["app.heygen.com"],
    credentialRef: "hivematrix.browser.heygen.primary",
    authStrategy: "keychain_password",
  });

  const sites = listBrowserSites();
  assert.equal(sites.length, 1);
  assert.equal(sites[0].credentialRef, "hivematrix.browser.heygen.primary");

  const credentialRow = getDb().prepare("SELECT * FROM browser_credentials WHERE siteId = ?").get("heygen") as Record<string, unknown>;
  assert.equal(credentialRow.credentialRef, "hivematrix.browser.heygen.primary");
  assert.equal("password" in credentialRow, false);
  assert.equal("secret" in credentialRow, false);
});

test("browser lane store lists enabled readiness probes and records runs", () => {
  upsertBrowserReadinessProbe({
    id: "heygen-home",
    siteId: "heygen",
    name: "Home",
    url: "https://app.heygen.com/home",
    assertions: [{ kind: "text", value: "Create video", optional: false }],
    requiresAuth: true,
  });

  const probes = listEnabledReadinessProbes("heygen");
  assert.equal(probes.length, 1);
  assert.equal(probes[0].assertions[0].value, "Create video");

  const run = recordBrowserReadinessRun({
    siteId: "heygen",
    probeId: "heygen-home",
    status: "ready",
    color: "green",
    summary: "All assertions passed",
    traceRunId: "trace-1",
    metadata: { failedAssertions: [] },
  });

  assert.equal(run.status, "ready");
  const row = getDb().prepare("SELECT * FROM browser_readiness_runs WHERE _id = ?").get(run.id) as { status: string; traceRunId: string };
  assert.equal(row.status, "ready");
  assert.equal(row.traceRunId, "trace-1");
});

test("browser lane store summaries include probe counts and no secret material", () => {
  const summaries = listBrowserSiteSummaries();

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].id, "heygen");
  assert.equal(summaries[0].probeCount, 1);
  assert.equal(summaries[0].credentialRef, "hivematrix.browser.heygen.primary");
  assert.equal("password" in summaries[0], false);
  assert.equal("secret" in summaries[0], false);
  assert.equal("token" in summaries[0], false);
});
