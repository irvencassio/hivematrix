import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const consoleSrc = readFileSync(new URL("../src/daemon/console.ts", import.meta.url), "utf8");

test("settings lanes tab exposes a read-only System Readiness card", () => {
  assert.match(consoleSrc, /System Readiness/);
  assert.match(consoleSrc, /system_readiness/);
  assert.match(consoleSrc, /api\("\/system\/readiness"\)/);
  assert.match(consoleSrc, /renderSystemReadiness/);
  assert.match(consoleSrc, /ok.*info.*warn.*critical/s);
  assert.match(consoleSrc, /Refresh/);
  assert.doesNotMatch(consoleSrc, /Repair all|Auto repair|repair_all/);
});

test("system readiness card exposes only explicit per-check repair buttons", () => {
  assert.match(consoleSrc, /systemReadinessRepair/);
  assert.match(consoleSrc, /\/system\/readiness\/repair/);
  assert.match(consoleSrc, /repairActions/);
  assert.doesNotMatch(consoleSrc, /Repair all|autoRepair|repair_all/);
});
