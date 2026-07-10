import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("config and API-facing copy uses lane names", () => {
  const features = read("src/lib/config/features.ts");
  const secrets = read("src/lib/config/secrets.ts");
  const server = read("src/daemon/server.ts");
  const beeTools = read("src/lib/orchestrator/lane-tools.ts");

  assert.match(features, /label: "Voice Lane"/);
  assert.doesNotMatch(features, /Voice \(VoiceBee\)/);

  assert.match(secrets, /Market Data Lane \(data only, never trades\)/);
  assert.doesNotMatch(secrets, /TraderBee/);

  assert.match(server, /Market Data Lane not configured/);
  assert.doesNotMatch(server, /TraderBee not configured/);

  assert.match(beeTools, /Unknown lane tool/);
  assert.doesNotMatch(beeTools, /Unknown bee tool/);

  // agent-profiles.ts no longer contains any lane/Bee-branded copy at all —
  // its only source of that language was the "inventor" agent profile's
  // system prompt, which the 2026-07-09 agent-roles-activation spec cut
  // (identical to "founder" on every admission-test axis: tools, deliverable,
  // model). This asserts the absence stays total, not that a specific phrase
  // survives — if lane/Bee-branded copy is ever reintroduced here, it must
  // use "lane" naming, never the old "Bee" brand.
  const profiles = read("src/lib/config/agent-profiles.ts");
  assert.doesNotMatch(profiles, /\bBee\b/);
});
