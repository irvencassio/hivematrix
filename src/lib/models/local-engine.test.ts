import test from "node:test";
import assert from "node:assert/strict";
import {
  getLocalEngineConfig, buildServeArgs, localTargetForRole, tierBaseUrl, DEFAULT_TIERS,
} from "./local-engine";

test("defaults: rapid-mlx engine, fast + coding tiers, reasoning OFF", () => {
  const c = getLocalEngineConfig({});
  assert.equal(c.engine, "rapid-mlx");
  assert.deepEqual(c.tiers.map((t) => t.key), ["fast", "coding"]);
  assert.equal(c.tiers[0].alias, "qwen3.6-35b-4bit");
  assert.equal(c.tiers[1].alias, "qwen3.6-27b-4bit");
  assert.ok(c.tiers.every((t) => t.reasoning === false));
});

test("config overrides merge over defaults (per tier by key)", () => {
  const c = getLocalEngineConfig({
    localEngine: {
      engine: "rapid-mlx",
      binary: "/x/rapid-mlx",
      tiers: [{ key: "fast", alias: "my-fast", port: 9000, reasoning: true }],
    },
  });
  assert.equal(c.binary, "/x/rapid-mlx");
  const fast = c.tiers.find((t) => t.key === "fast")!;
  assert.equal(fast.alias, "my-fast");
  assert.equal(fast.port, 9000);
  assert.equal(fast.reasoning, true);
  // untouched tier keeps its default
  assert.equal(c.tiers.find((t) => t.key === "coding")!.alias, "qwen3.6-27b-4bit");
});

test("buildServeArgs adds --no-thinking only when reasoning off", () => {
  assert.deepEqual(buildServeArgs(DEFAULT_TIERS[0]),
    ["serve", "qwen3.6-35b-4bit", "--port", "8000", "--no-thinking"]);
  assert.deepEqual(buildServeArgs({ key: "fast", alias: "m", port: 1, reasoning: true }),
    ["serve", "m", "--port", "1"]);
});

test("roles map to tiers: operational→fast, coding/thinking→coding", () => {
  const c = getLocalEngineConfig({});
  assert.equal(localTargetForRole("operational", c)!.tier, "fast");
  assert.equal(localTargetForRole("operational", c)!.endpoint, "http://127.0.0.1:8000/v1");
  assert.equal(localTargetForRole("coding", c)!.tier, "coding");
  assert.equal(localTargetForRole("coding", c)!.model, "qwen3.6-27b-4bit");
  assert.equal(localTargetForRole("thinking", c)!.tier, "coding");
});

test("tierBaseUrl uses loopback + port", () => {
  assert.equal(tierBaseUrl(DEFAULT_TIERS[1]), "http://127.0.0.1:8001/v1");
});
