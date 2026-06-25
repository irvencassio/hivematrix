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
  createBrowserTraceRun,
  recordBrowserTraceEvent,
  completeBrowserTraceRun,
  getBrowserTraceRun,
  listBrowserTraceRuns,
  recordBrowserReadinessRun,
  upsertBrowserReadinessProbe,
  upsertBrowserSite,
  listBrowserSiteSummaries,
  getBrowserLaneReadinessDashboard,
  matchBrowserSiteReadiness,
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

test("browser lane store lists trace runs and redacts event payload details", () => {
  const traceRunId = createBrowserTraceRun({ siteId: "heygen", workflowId: "heygen-home", metadata: { source: "test" } });
  recordBrowserTraceEvent({
    traceRunId,
    event: "probe.snapshot",
    payload: {
      message: "snapshot recorded",
      nested: {
        token: "abc123",
        safe: "visible",
      },
      password: "super-secret",
    },
  });
  completeBrowserTraceRun(traceRunId, "failed", { token: "nope", reason: "blocked" });

  const traces = listBrowserTraceRuns();
  assert.equal(traces[0].id, traceRunId);
  assert.equal(traces[0].metadata.reason, "blocked");
  assert.equal(traces[0].metadata.token, "[redacted]");

  const detail = getBrowserTraceRun(traceRunId);
  assert.ok(detail);
  assert.equal(detail.events.length, 1);
  assert.equal(detail.events[0].payload.password, "[redacted]");
  assert.deepEqual(detail.events[0].payload.nested, { token: "[redacted]", safe: "visible" });
});

test("readiness dashboard aggregates latest run, credential ref, and color rollup", () => {
  // A second site with no readiness run yet stays honestly "unknown/gray".
  upsertBrowserSite({
    id: "vercel",
    displayName: "Vercel",
    homeUrl: "https://vercel.com/dashboard",
    allowedDomains: ["vercel.com"],
  });
  // Record a fresh run for heygen that supersedes the earlier "ready" run.
  recordBrowserReadinessRun({
    siteId: "heygen",
    probeId: "heygen-home",
    status: "needs_reauth",
    color: "orange",
    summary: "Session expired",
    traceRunId: "trace-9",
  });

  const dashboard = getBrowserLaneReadinessDashboard();
  assert.equal(dashboard.lane, "browser");
  assert.equal(dashboard.laneDisplayName, "Browser Lane");
  assert.equal(dashboard.totals.sites, 2);

  const heygen = dashboard.sites.find((s) => s.id === "heygen");
  assert.ok(heygen);
  assert.equal(heygen.readiness.status, "needs_reauth");
  assert.equal(heygen.readiness.color, "orange");
  assert.equal(heygen.readiness.traceRunId, "trace-9");
  assert.equal(heygen.credentialRef, "hivematrix.browser.heygen.primary");
  assert.equal(heygen.probeCount, 1);
  // Never leak secret material into the dashboard.
  assert.equal("password" in heygen, false);
  assert.equal("secret" in heygen, false);

  const vercel = dashboard.sites.find((s) => s.id === "vercel");
  assert.ok(vercel);
  assert.equal(vercel.readiness.status, "unknown");
  assert.equal(vercel.readiness.color, "gray");
  assert.equal(vercel.credentialRef, null);

  assert.equal(dashboard.totals.byColor.orange, 1);
  assert.equal(dashboard.totals.byColor.gray, 1);
  assert.equal(dashboard.totals.needsAttention, 1);
});

test("matchBrowserSiteReadiness matches a site by domain and returns metadata only", () => {
  // heygen (orange/needs_reauth from the prior test) + vercel (gray/no-run).
  const m = matchBrowserSiteReadiness(["app.heygen.com"]);
  assert.equal(m.matched, true);
  assert.equal(m.siteId, "heygen");
  assert.equal(m.siteName, "HeyGen");
  assert.equal(m.color, "orange");
  assert.equal(m.status, "needs_reauth");
  assert.equal(m.credentialRef, "hivematrix.browser.heygen.primary"); // pointer, not a secret
  assert.equal(m.traceRunId, "trace-9");
  // Never any secret material.
  assert.equal("password" in m, false);
  assert.equal("cookie" in m, false);
  assert.equal("secret" in m, false);
});

test("matchBrowserSiteReadiness matches subdomains and reports gray for no-run sites", () => {
  const sub = matchBrowserSiteReadiness(["www.app.heygen.com"]);
  assert.equal(sub.matched, true);
  assert.equal(sub.siteId, "heygen");

  const vercel = matchBrowserSiteReadiness(["vercel.com"]);
  assert.equal(vercel.matched, true);
  assert.equal(vercel.color, "gray");
  assert.equal(vercel.status, "unknown");
});

test("matchBrowserSiteReadiness returns matched:false for an unknown domain", () => {
  const m = matchBrowserSiteReadiness(["no-such-site.example"]);
  assert.equal(m.matched, false);
  assert.equal(m.siteId, null);
  assert.equal(m.color, null);
  assert.equal(m.credentialRef, null);
});
