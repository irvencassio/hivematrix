import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getLocalFallbackDecision, isEligibleForLocalFallback } from "./fallback";
import { invalidateCachedLocalModelHealth, writeCachedLocalModelHealth } from "./health";

async function withTempHome<T>(config: Record<string, unknown>, run: () => Promise<T> | T): Promise<T> {
  const originalHome = process.env.HOME;
  const tempHome = mkdtempSync(join(tmpdir(), "hive-local-fallback-test-"));
  mkdirSync(join(tempHome, ".hivematrix"), { recursive: true });
  writeFileSync(join(tempHome, ".hivematrix", "config.json"), JSON.stringify(config, null, 2));
  process.env.HOME = tempHome;
  invalidateCachedLocalModelHealth();
  try {
    return await run();
  } finally {
    invalidateCachedLocalModelHealth();
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
}

test("usage fallback switches supported cloud tasks to the healthy local model", async () => {
  const decision = await withTempHome({
    localModel: {
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434/v1",
      modelName: "qwen2.5-coder",
    },
  }, async () => {
    writeCachedLocalModelHealth({
      checkedAt: new Date().toISOString(),
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434/v1",
      modelName: "qwen2.5-coder",
      ok: true,
      ready: true,
      modelFound: true,
      streaming: true,
      toolCalls: true,
      offlineReady: true,
      message: "ok",
      models: ["qwen2.5-coder"],
    });

    return getLocalFallbackDecision({
      currentModelId: "codex:gpt-5.4",
      project: "ops",
      reason: "usage",
    });
  });

  assert.equal(decision?.modelId, "qwen2.5-coder");
  assert.equal(decision?.reason, "usage");
});

test("offline fallback requires a loopback local endpoint", async () => {
  const decision = await withTempHome({
    localModel: {
      provider: "ollama",
      endpoint: "http://192.168.1.10:11434/v1",
      modelName: "qwen2.5-coder",
    },
  }, async () => {
    writeCachedLocalModelHealth({
      checkedAt: new Date().toISOString(),
      provider: "ollama",
      endpoint: "http://192.168.1.10:11434/v1",
      modelName: "qwen2.5-coder",
      ok: true,
      ready: true,
      modelFound: true,
      streaming: true,
      toolCalls: true,
      offlineReady: false,
      message: "ok",
      models: ["qwen2.5-coder"],
    });

    return getLocalFallbackDecision({
      currentModelId: "codex:gpt-5.4",
      project: "ops",
      reason: "offline",
    });
  });

  assert.equal(decision, null);
});

test("nan ai is treated as a local fallback provider", async () => {
  const decision = await withTempHome({
    localModel: {
      provider: "nanai",
      endpoint: "http://127.0.0.1:3000/v1",
      modelName: "nan-ai-model",
    },
  }, async () => {
    writeCachedLocalModelHealth({
      checkedAt: new Date().toISOString(),
      provider: "nanai",
      endpoint: "http://127.0.0.1:3000/v1",
      modelName: "nan-ai-model",
      ok: true,
      ready: true,
      modelFound: true,
      streaming: true,
      toolCalls: true,
      offlineReady: true,
      message: "ok",
      models: ["nan-ai-model"],
    });

    return getLocalFallbackDecision({
      currentModelId: "claude-sonnet-4-6",
      project: "ops",
      reason: "offline",
    });
  });

  assert.equal(decision?.modelId, "nan-ai-model");
});

test("computer use tasks are never auto-fallback candidates", () => {
  assert.equal(isEligibleForLocalFallback("codex:gpt-5.4-computer-use"), false);
});
