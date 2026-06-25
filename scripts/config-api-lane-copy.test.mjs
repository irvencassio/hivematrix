import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("config and API-facing copy uses lane names", () => {
  const features = read("src/lib/config/features.ts");
  const secrets = read("src/lib/config/secrets.ts");
  const profiles = read("src/lib/config/agent-profiles.ts");
  const server = read("src/daemon/server.ts");
  const beeTools = read("src/lib/orchestrator/lane-tools.ts");

  assert.match(features, /label: "Voice Lane"/);
  assert.doesNotMatch(features, /Voice \(VoiceBee\)/);

  assert.match(secrets, /Market Data Lane \(data only, never trades\)/);
  assert.doesNotMatch(secrets, /TraderBee/);

  assert.match(profiles, /new skill, MCP, lane, or shared capability contract/);
  assert.doesNotMatch(profiles, /new skill, MCP, Bee/);

  assert.match(server, /Market Data Lane not configured/);
  assert.doesNotMatch(server, /TraderBee not configured/);

  assert.match(beeTools, /Unknown lane tool/);
  assert.doesNotMatch(beeTools, /Unknown bee tool/);
});
