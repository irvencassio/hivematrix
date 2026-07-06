import { test } from "node:test";
import assert from "node:assert/strict";
import { healthMatchesConfig, type LocalModelHealth } from "@/lib/local-model/health";
import type { LocalModelConfig } from "@/lib/config/constants";

const QWEN_CONFIG: LocalModelConfig = {
  provider: "mlx",
  endpoint: "http://127.0.0.1:8000/v1",
  modelName: "qwen3.6-35b-4bit",
};

function health(overrides: Partial<LocalModelHealth>): LocalModelHealth {
  return {
    checkedAt: "2026-07-03T21:00:00.000Z",
    provider: "mlx",
    endpoint: "http://127.0.0.1:8000/v1",
    modelName: "qwen3.6-35b-4bit",
    ok: true,
    ready: true,
    modelFound: true,
    streaming: true,
    toolCalls: true,
    offlineReady: true,
    message: "ok",
    models: ["qwen3.6-35b-4bit", "qwen3.6-27b-4bit"],
    ...overrides,
  };
}

test("healthMatchesConfig: cache for the configured Rapid-MLX Qwen model matches", () => {
  assert.equal(healthMatchesConfig(health({}), QWEN_CONFIG), true);
});

test("healthMatchesConfig: a stale nan-ai-model/:3000 cache does NOT match a Qwen config", () => {
  // Exact regression: config switched to Rapid-MLX on :8000 but the cache still
  // describes the decommissioned nan-ai-model on :3000. It must be treated stale.
  const stale = health({
    provider: "nanai",
    endpoint: "http://127.0.0.1:3000/v1",
    modelName: "nan-ai-model",
    models: ["nan-ai-model"],
  });
  assert.equal(healthMatchesConfig(stale, QWEN_CONFIG), false);
});

test("healthMatchesConfig: endpoint or model mismatch alone is enough to reject", () => {
  assert.equal(healthMatchesConfig(health({ endpoint: "http://127.0.0.1:3000/v1" }), QWEN_CONFIG), false);
  assert.equal(healthMatchesConfig(health({ modelName: "qwen3.6-27b-4bit" }), QWEN_CONFIG), false);
  assert.equal(healthMatchesConfig(health({ provider: "vllm" }), QWEN_CONFIG), false);
});

test("healthMatchesConfig: null health or null config never matches", () => {
  assert.equal(healthMatchesConfig(null, QWEN_CONFIG), false);
  assert.equal(healthMatchesConfig(health({}), null), false);
});
