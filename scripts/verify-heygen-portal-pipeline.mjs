#!/usr/bin/env node
/**
 * Dry-run verification of the HeyGen portal video pipeline:
 *   draft → portal task → portal completion → publish-only.
 *
 * Runs entirely against a temp HOME + temp DB (scratch) with fake runners — it
 * NEVER calls real HeyGen or YouTube and never touches real drafts. Exits 0 on
 * success, 1 on any failed phase.
 *
 *   npm run verify:portal
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "heygen-portal-verify-home-"));
const dbDir = mkdtempSync(join(tmpdir(), "heygen-portal-verify-db-"));
// Isolate state BEFORE importing the pipeline modules (they resolve paths from env).
process.env.HOME = home;
process.env.HIVEMATRIX_DB_PATH = join(dbDir, "verify.db");

let code;
try {
  const { runHeyGenPortalDryRun } = await import("@/lib/video/verify-portal-pipeline");
  const report = await runHeyGenPortalDryRun();
  for (const phase of report.phases) {
    console.log(`${phase.ok ? "✓" : "✗"} ${phase.name} — ${phase.detail}`);
  }
  console.log(`\n${report.summary}`);
  code = report.ok ? 0 : 1;
} catch (err) {
  console.error(`verify:portal crashed: ${err instanceof Error ? err.message : err}`);
  code = 1;
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(dbDir, { recursive: true, force: true });
}
process.exit(code);
