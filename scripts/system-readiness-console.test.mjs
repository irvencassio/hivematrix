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
  assert.doesNotMatch(consoleSrc, /systemReadinessRepair|Repair all|Auto repair/);
});
