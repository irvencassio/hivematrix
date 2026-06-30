/**
 * T4 — Review Lane canonical symbol tests.
 *
 * RED until Tasks 8–9:
 *   - buildReviewLaneReport / ReviewLaneReport not yet exported from report.ts
 *   - getReviewLaneStatus / startReviewLaneHeartbeat not yet exported from heartbeat.ts
 *
 * The static imports below will produce TypeScript errors ("has no exported member")
 * until the canonical exports are added. At runtime the values will be undefined,
 * so the assertions below will fail with TypeError or assertion errors.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Isolate DB before importing anything that touches it
const TMP = mkdtempSync(join(tmpdir(), "hm-review-lane-symbols-test-"));
process.env.HOME = TMP;
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");

_resetDbForTests();
getDb();

test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

// Dynamic imports so the individual test assertions provide meaningful failure
// messages instead of a top-level module-load failure.
const reportMod = await import("./report");
const heartbeatMod = await import("./heartbeat");

// Canonical function exports ─ RED until Task 8
test("buildReviewLaneReport is exported from report.ts", () => {
  assert.equal(typeof (reportMod as Record<string, unknown>).buildReviewLaneReport, "function");
});

test("buildReviewLaneReport returns a valid report object", () => {
  const fn = (reportMod as Record<string, unknown>).buildReviewLaneReport as (() => unknown) | undefined;
  assert.equal(typeof fn, "function", "buildReviewLaneReport must be a function");
  const report = fn!();
  assert.equal(typeof report, "object");
  assert.notEqual(report, null);
});

test("buildReviewLaneReport and buildManagerBeeReport return same-shaped report", () => {
  const canonical = ((reportMod as Record<string, unknown>).buildReviewLaneReport as (() => Record<string, unknown>) | undefined)?.();
  const legacy = reportMod.buildManagerBeeReport();
  assert.ok(canonical, "buildReviewLaneReport must be defined");
  assert.deepEqual(Object.keys(canonical).sort(), Object.keys(legacy).sort());
});

// Canonical status export ─ RED until Task 9
test("getReviewLaneStatus is exported from heartbeat.ts", () => {
  assert.equal(typeof (heartbeatMod as Record<string, unknown>).getReviewLaneStatus, "function");
});

test("getReviewLaneStatus and getManagerBeeStatus return same-shaped report", () => {
  const canonicalFn = (heartbeatMod as Record<string, unknown>).getReviewLaneStatus as (() => Record<string, unknown>) | undefined;
  assert.equal(typeof canonicalFn, "function", "getReviewLaneStatus must be a function");
  const canonical = canonicalFn!();
  const legacy = heartbeatMod.getManagerBeeStatus();
  assert.deepEqual(Object.keys(canonical).sort(), Object.keys(legacy).sort());
});

// Deprecated aliases must remain for one release window ─ should stay GREEN
test("buildManagerBeeReport (deprecated) is still exported", () => {
  assert.equal(typeof reportMod.buildManagerBeeReport, "function");
});

test("getManagerBeeStatus (deprecated) is still exported", () => {
  assert.equal(typeof heartbeatMod.getManagerBeeStatus, "function");
});
