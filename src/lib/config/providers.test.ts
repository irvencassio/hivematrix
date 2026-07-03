import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { detectProvider, resolveProvider } from "./providers";
import { DEEPSEEK_FLASH_API_MODEL_ID, DEEPSEEK_FLASH_GGUF_NAME } from "@/lib/models/local-presets";

function withTempHome<T>(config: Record<string, unknown>, run: () => T): T {
  const originalHome = process.env.HOME;
  const tempHome = mkdtempSync(join(tmpdir(), "hive-providers-test-"));
  mkdirSync(join(tempHome, ".hivematrix"), { recursive: true });
  writeFileSync(join(tempHome, ".hivematrix", "config.json"), JSON.stringify(config, null, 2));
  process.env.HOME = tempHome;
  try {
    return run();
  } finally {
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
}

test("detectProvider resolves the configured local model to its local provider", () => {
  const provider = withTempHome({
    localModel: {
      provider: "ollama",
      endpoint: "http://localhost:11434/v1",
      modelName: "qwen2.5-coder",
    },
  }, () => detectProvider("qwen2.5-coder"));

  assert.equal(provider, "ollama");
});

test("detectProvider resolves Nan AI as a local provider", () => {
  const provider = withTempHome({
    localModel: {
      provider: "nanai",
      endpoint: "http://localhost:3000/v1",
      modelName: "nan-ai-model",
    },
  }, () => detectProvider("nan-ai-model"));

  assert.equal(provider, "nanai");
});

test("resolveProvider uses the configured local-model endpoint for Nan AI", () => {
  const provider = withTempHome({
    localModel: {
      provider: "nanai",
      endpoint: "http://127.0.0.1:3000/v1",
      modelName: "nan-ai-model",
    },
  }, () => resolveProvider("nan-ai-model"));

  assert.equal(provider?.name, "nanai");
  assert.equal(provider?.endpoint, "http://127.0.0.1:3000/v1");
});

test("detectProvider resolves Dwarf Star as a local provider", () => {
  const provider = withTempHome({
    localModel: {
      provider: "dwarfstar",
      endpoint: "http://127.0.0.1:8000/v1",
      modelName: "deepseek-v4-flash",
    },
  }, () => detectProvider("deepseek-v4-flash"));

  assert.equal(provider, "dwarfstar");
});

test("resolveProvider routes the supported DeepSeek Flash preset to Dwarf Star", () => {
  const provider = withTempHome({}, () => resolveProvider(DEEPSEEK_FLASH_API_MODEL_ID));

  assert.equal(provider?.name, "dwarfstar");
  assert.equal(provider?.endpoint, "http://127.0.0.1:8000/v1");
  assert.equal(provider?.maxTokens, 32768);
});

test("resolveProvider accepts the DeepSeek Flash GGUF name as a Dwarf Star preset alias", () => {
  const provider = withTempHome({}, () => resolveProvider(DEEPSEEK_FLASH_GGUF_NAME));

  assert.equal(provider?.name, "dwarfstar");
  assert.equal(provider?.endpoint, "http://127.0.0.1:8000/v1");
});
