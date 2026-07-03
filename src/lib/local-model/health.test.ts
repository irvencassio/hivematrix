import { test } from "node:test";
import assert from "node:assert/strict";
import { healthMatchesConfig, type LocalModelHealth } from "@/lib/local-model/health";
import type { LocalModelConfig } from "@/lib/config/constants";

const DWARFSTAR_CONFIG: LocalModelConfig = {
  provider: "dwarfstar",
  endpoint: "http://127.0.0.1:8000/v1",
  modelName: "deepseek-v4-flash",
};

function health(overrides: Partial<LocalModelHealth>): LocalModelHealth {
  return {
    checkedAt: "2026-07-03T21:00:00.000Z",
    provider: "dwarfstar",
    endpoint: "http://127.0.0.1:8000/v1",
    modelName: "deepseek-v4-flash",
    ok: true,
    ready: true,
    modelFound: true,
    streaming: true,
    toolCalls: true,
    offlineReady: true,
    message: "ok",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    ...overrides,
  };
}

test("healthMatchesConfig: cache for the configured Dwarf Star DeepSeek model matches", () => {
  assert.equal(healthMatchesConfig(health({}), DWARFSTAR_CONFIG), true);
});

test("healthMatchesConfig: a stale nan-ai-model/:3000 cache does NOT match a Dwarf Star config", () => {
  // Exact regression: config switched to Dwarf Star on :8000 but the cache still
  // describes the decommissioned nan-ai-model on :3000. It must be treated stale.
  const stale = health({
    provider: "nanai",
    endpoint: "http://127.0.0.1:3000/v1",
    modelName: "nan-ai-model",
    models: ["nan-ai-model"],
  });
  assert.equal(healthMatchesConfig(stale, DWARFSTAR_CONFIG), false);
});

test("healthMatchesConfig: endpoint or model mismatch alone is enough to reject", () => {
  assert.equal(healthMatchesConfig(health({ endpoint: "http://127.0.0.1:3000/v1" }), DWARFSTAR_CONFIG), false);
  assert.equal(healthMatchesConfig(health({ modelName: "deepseek-v4-pro" }), DWARFSTAR_CONFIG), false);
  assert.equal(healthMatchesConfig(health({ provider: "vllm" }), DWARFSTAR_CONFIG), false);
});

test("healthMatchesConfig: null health or null config never matches", () => {
  assert.equal(healthMatchesConfig(null, DWARFSTAR_CONFIG), false);
  assert.equal(healthMatchesConfig(health({}), null), false);
});
