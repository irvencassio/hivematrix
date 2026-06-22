import test from "node:test";
import assert from "node:assert/strict";
import {
  getLocalEngineConfig, buildServeArgs, localTargetForRole, tierBaseUrl, tierForAlias, DEFAULT_TIERS,
  localEngineCapability,
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

test("tierForAlias maps a model id to its tier (for endpoint routing)", () => {
  const c = getLocalEngineConfig({});
  assert.equal(tierForAlias("qwen3.6-35b-4bit", c)!.port, 8000);
  assert.equal(tierForAlias("qwen3.6-27b-4bit", c)!.port, 8001);
  assert.equal(tierForAlias("claude-opus-4-8", c), null);
});

test("capability: non-Apple-Silicon → cloud-only, no tiers", () => {
  const cap = localEngineCapability({ arch: "x64", ramGB: 64 });
  assert.equal(cap.localCapable, false);
  assert.deepEqual(cap.recommendedTiers, []);
  assert.ok(cap.tiers.every((t) => !t.capable && /Apple Silicon/.test(t.reason ?? "")));
  assert.match(cap.reason ?? "", /Apple Silicon/);
});

test("capability: 16 GB → cloud-only (neither tier fits with headroom)", () => {
  const cap = localEngineCapability({ arch: "arm64", ramGB: 16 });
  assert.equal(cap.localCapable, false);
  assert.deepEqual(cap.recommendedTiers, []);
  assert.match(cap.reason ?? "", /local model/);
});

test("capability: 32 GB → coding tier only resident (35B needs ~34 GB)", () => {
  const cap = localEngineCapability({ arch: "arm64", ramGB: 32 });
  assert.equal(cap.localCapable, true);
  assert.deepEqual(cap.recommendedTiers, ["coding"]);
  assert.equal(cap.tiers.find((t) => t.key === "fast")!.capable, false);
  assert.equal(cap.tiers.find((t) => t.key === "coding")!.residentCapable, true);
});

test("capability: 48 GB → one tier resident (fast), coding available on-demand only", () => {
  const cap = localEngineCapability({ arch: "arm64", ramGB: 48 });
  assert.equal(cap.localCapable, true);
  assert.deepEqual(cap.recommendedTiers, ["fast"]);
  const coding = cap.tiers.find((t) => t.key === "coding")!;
  assert.equal(coding.capable, true);          // runnable on demand
  assert.equal(coding.residentCapable, false); // but not resident alongside fast
  assert.match(coding.reason ?? "", /on-demand/);
});

test("capability: 64 GB → both tiers resident", () => {
  const cap = localEngineCapability({ arch: "arm64", ramGB: 64 });
  assert.equal(cap.localCapable, true);
  assert.deepEqual(cap.recommendedTiers, ["fast", "coding"]);
  assert.ok(cap.tiers.every((t) => t.capable && t.residentCapable));
});
