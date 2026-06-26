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
