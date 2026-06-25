import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-heygen-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { resolveCooRouteFromRules } = await import("@/lib/coo/store");
const {
  HEYGEN_SITE,
  HEYGEN_HANDOFF_POINTS,
  seedHeyGenBrowserSite,
  buildHeyGenVideoJob,
} = await import("./heygen");

before(() => { _resetDbForTests(); getDb(); });
after(() => { _resetDbForTests(); delete process.env.HIVEMATRIX_DB_PATH; rmSync(TMP, { recursive: true, force: true }); });
beforeEach(() => {
  getDb().exec("DELETE FROM browser_sites; DELETE FROM browser_credentials; DELETE FROM browser_readiness_probes; DELETE FROM coo_routing_rules; DELETE FROM coo_routing_rule_history;");
});

test("seedHeyGenBrowserSite creates a metadata-only site, probe, and routing rule (idempotent)", () => {
  const first = seedHeyGenBrowserSite();
  assert.equal(first.site.id, "heygen");
  assert.deepEqual(first.site.allowedDomains.includes("app.heygen.com"), true);

  const db = getDb();
  const siteRow = db.prepare("SELECT * FROM browser_sites WHERE _id = 'heygen'").get() as Record<string, unknown>;
  assert.ok(siteRow);
  assert.equal("password" in siteRow, false);
  assert.equal("secret" in siteRow, false);

  const probeCount = (db.prepare("SELECT COUNT(*) AS n FROM browser_readiness_probes WHERE siteId = 'heygen'").get() as { n: number }).n;
  assert.ok(probeCount >= 1);

  const ruleCount = (db.prepare("SELECT COUNT(*) AS n FROM coo_routing_rules WHERE lane = 'browser'").get() as { n: number }).n;
  assert.ok(ruleCount >= 1);

  // Credential row, if any, holds only a ref pointer — never a secret.
  const cred = db.prepare("SELECT * FROM browser_credentials WHERE siteId = 'heygen'").get() as Record<string, unknown> | undefined;
  if (cred) {
    assert.equal("password" in cred, false);
    assert.match(String(cred.credentialRef), /^hivematrix\.browser\./);
  }

  // Idempotent: re-seeding doesn't duplicate the site.
  seedHeyGenBrowserSite();
  const siteN = (db.prepare("SELECT COUNT(*) AS n FROM browser_sites WHERE _id = 'heygen'").get() as { n: number }).n;
  assert.equal(siteN, 1);
});

test("COO routing resolves HeyGen domains to the Browser Lane after seeding", () => {
  seedHeyGenBrowserSite();
  const route = resolveCooRouteFromRules({ text: "make a heygen video", domains: ["app.heygen.com"] });
  assert.equal(route?.lane, "browser");
});

test("buildHeyGenVideoJob requires login and lists every manual handoff point", () => {
  const job = buildHeyGenVideoJob({ script: "Hello world. This is the script.", title: "Launch Day" });
  assert.equal(job.requiresLogin, true);
  assert.match(job.startUrl, /heygen\.com/);
  assert.ok(job.allowedDomains.includes("app.heygen.com"));

  const steps = job.steps.join("\n").toLowerCase();
  for (const marker of [/login|sign in/, /two[- ]factor|2fa/, /captcha/, /file picker/, /preview/, /export/]) {
    assert.match(steps, marker, `handoff for ${marker} should be present`);
  }
  // The handoff constant is exposed and complete.
  assert.ok(HEYGEN_HANDOFF_POINTS.length >= 5);
});

test("buildHeyGenVideoJob carries the script but never embeds secrets", () => {
  const job = buildHeyGenVideoJob({
    script: "Scene one: the founder speaks.",
    title: "Pitch",
    creativeNotes: "Cinematic, upbeat",
    assetPaths: ["/Users/me/logo.png"],
  });
  const blob = JSON.stringify(job);
  assert.match(blob, /Scene one/);          // script content preserved
  assert.match(blob, /Cinematic/);          // creative notes preserved
  assert.doesNotMatch(blob, /password|cookie|\btoken\b|credentialRef|secret/i);
});

test("HEYGEN_SITE exposes only metadata (a credentialRef pointer, no secret value)", () => {
  const blob = JSON.stringify(HEYGEN_SITE);
  assert.doesNotMatch(blob, /password|cookie|secret/i);
  if (HEYGEN_SITE.credentialRef) assert.match(HEYGEN_SITE.credentialRef, /^hivematrix\.browser\./);
});
