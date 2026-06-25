import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolated HOME (drafts) + DB (browser-lane/coo tables) — no real data touched.
const originalHome = process.env.HOME;
const home = mkdtempSync(join(tmpdir(), "hm-portal-verify-home-"));
const dbDir = mkdtempSync(join(tmpdir(), "hm-portal-verify-db-"));
process.env.HOME = home;
process.env.HIVEMATRIX_DB_PATH = join(dbDir, "verify.db");

const { runHeyGenPortalDryRun } = await import("./verify-portal-pipeline");

test.after(() => {
  if (originalHome) process.env.HOME = originalHome;
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(home, { recursive: true, force: true });
  rmSync(dbDir, { recursive: true, force: true });
});

test("dry-run exercises every pipeline phase and passes end-to-end", async () => {
  const report = await runHeyGenPortalDryRun();
  assert.equal(report.dryRun, true);
  for (const phase of report.phases) {
    assert.equal(phase.ok, true, `phase "${phase.name}" should pass: ${phase.detail}`);
  }
  assert.equal(report.ok, true);

  const names = report.phases.map((p) => p.name);
  for (const expected of ["seed", "draft", "readiness-gate", "portal-task", "completion", "publish-only", "needs-publish-refusal", "endpoint-wiring"]) {
    assert.ok(names.includes(expected), `missing phase ${expected}`);
  }
});

test("publish-only is a dry run: it shapes publish.mjs but never re-renders or uploads", async () => {
  const report = await runHeyGenPortalDryRun();
  assert.ok(report.evidence.publishArgs.includes("publish.mjs"), "should run the publish step");
  assert.ok(!report.evidence.publishArgs.includes("make-avatar.mjs"), "must NOT re-render");
});

test("the harness fails loudly when endpoint wiring is broken", async () => {
  const report = await runHeyGenPortalDryRun({ serverSource: () => "// endpoints removed" });
  assert.equal(report.ok, false);
  const wiring = report.phases.find((p) => p.name === "endpoint-wiring");
  assert.equal(wiring?.ok, false);
  assert.match(wiring?.detail ?? "", /video\/(heygen-workflow|publish-draft|portal-complete)/);
});

test("the verification report carries no secret material", async () => {
  const report = await runHeyGenPortalDryRun();
  assert.doesNotMatch(JSON.stringify(report), /password|cookie|secret|credentialRef|\btoken\b/i);
});
