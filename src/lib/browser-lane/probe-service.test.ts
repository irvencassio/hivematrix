import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";

import type { BrowserLaneAdapter, PageSnapshot } from "./adapter";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-browser-lane-probe-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { runBrowserLaneReadiness } = await import("./probe-service");
const { upsertBrowserReadinessProbe, upsertBrowserSite } = await import("./store");

function adapter(snapshot: PageSnapshot): BrowserLaneAdapter {
  return {
    async open() {
      return { ok: true, pageId: "page-1" };
    },
    async snapshot() {
      return snapshot;
    },
    async act() {
      return { ok: true };
    },
    async screenshot() {
      return { ok: true, path: "/tmp/browser-lane.png" };
    },
    async close() {
      return { ok: true };
    },
  };
}

before(() => {
  _resetDbForTests();
  getDb();
});

beforeEach(() => {
  getDb().exec(`
    DELETE FROM browser_trace_events;
    DELETE FROM browser_trace_runs;
    DELETE FROM browser_readiness_runs;
    DELETE FROM browser_readiness_probes;
    DELETE FROM browser_credentials;
    DELETE FROM browser_sites;
  `);
});

after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

function seedHeygen(): void {
  upsertBrowserSite({
    id: "heygen",
    displayName: "HeyGen",
    homeUrl: "https://app.heygen.com/home",
    loginUrl: "https://app.heygen.com/login",
    allowedDomains: ["app.heygen.com"],
    credentialRef: "hivematrix.browser.heygen.primary",
  });
  upsertBrowserReadinessProbe({
    id: "heygen-home",
    siteId: "heygen",
    name: "Home",
    url: "https://app.heygen.com/home",
    assertions: [{ kind: "text", value: "Create video", optional: false }],
  });
}

test("probe service runs configured probes and persists trace events", async () => {
  seedHeygen();
  const result = await runBrowserLaneReadiness({
    siteId: "heygen",
    adapter: adapter({
      url: "https://app.heygen.com/home",
      title: "HeyGen",
      state: "authenticated",
      actions: [],
      forms: [],
      text: "Dashboard Create video",
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].status, "ready");
  assert.equal(result.runs[0].traceRunId.length > 0, true);

  const runCount = getDb().prepare("SELECT COUNT(*) AS n FROM browser_readiness_runs").get() as { n: number };
  const eventCount = getDb().prepare("SELECT COUNT(*) AS n FROM browser_trace_events").get() as { n: number };
  assert.equal(runCount.n, 1);
  assert.equal(eventCount.n > 0, true);
});

test("probe service default adapter records a blocked run instead of returning a stub", async () => {
  seedHeygen();
  const result = await runBrowserLaneReadiness({ siteId: "heygen" });

  assert.equal(result.ok, true);
  assert.equal(result.backendReady, false);
  assert.equal(result.runs[0].status, "blocked");
  assert.match(result.runs[0].error ?? "", /not wired yet/);
});

test("probe service reports a missing site clearly", async () => {
  const result = await runBrowserLaneReadiness({ siteId: "missing" });

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /No Browser Lane site/);
  assert.deepEqual(result.runs, []);
});
