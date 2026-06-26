import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../src/daemon/server.ts", import.meta.url), "utf8");

test("daemon exposes the read-only system readiness endpoint", () => {
  assert.match(server, /GET \/system\/readiness/);
  assert.match(server, /urlPath === "\/system\/readiness"/);
  assert.match(server, /getSystemReadinessReport/);
  assert.doesNotMatch(server, /\/system\/readiness[\s\S]{0,2200}seedDefaultCooRoutingRules/);
  assert.doesNotMatch(server, /\/system\/readiness[\s\S]{0,2200}installLaneApp/);
});

test("daemon exposes explicit system readiness repair endpoint with an action allowlist", () => {
  assert.match(server, /POST \/system\/readiness\/repair/);
  assert.match(server, /urlPath === "\/system\/readiness\/repair"/);
  assert.match(server, /performSystemReadinessRepair/);
  assert.match(server, /seed_coo_rules/);
  assert.match(server, /seed_heygen_browser_site/);
  assert.match(server, /refresh_legacy_video_reviews/);
  assert.doesNotMatch(server, /repair_all|autoRepair|Repair all/);
});
