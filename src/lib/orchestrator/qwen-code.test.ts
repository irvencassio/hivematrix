import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildQwenProvider, isQwenCodeAvailable } from "./qwen-code";
import type { QwenProfile } from "@/lib/config/qwen-profile";

function withTempHome<T>(config: Record<string, unknown>, run: () => T): T {
  const originalHome = process.env.HOME;
  const tempHome = mkdtempSync(join(tmpdir(), "hivematrix-qwen-code-test-"));
  mkdirSync(join(tempHome, ".hivematrix"), { recursive: true });
  writeFileSync(join(tempHome, ".hivematrix", "config.json"), JSON.stringify(config));
  process.env.HOME = tempHome;
  try {
    return run();
  } finally {
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
}

const sampleProfile: QwenProfile = {
  location: "local",
  primary: {
    modelId: "qwen3-coder-80b",
    endpoint: "http://localhost:8080",
    provider: "mlx",
    contextLimit: 65536,
  },
  secondary: {
    modelId: "qwen3-35b",
    endpoint: "http://localhost:8080",
    provider: "mlx",
    contextLimit: 32768,
  },
  thinkingEnabled: true,
  minDecodeRate: 15,
  probeTimeoutMs: 60000,
};

test("buildQwenProvider returns provider with primary model by default", () => {
  const provider = buildQwenProvider(sampleProfile, false);
  assert.ok(provider !== null);
  assert.equal(provider!.maxTokens, 65536);
  assert.equal(provider!.name, "mlx");
  assert.equal(provider!.endpoint, "http://localhost:8080");
});

test("buildQwenProvider uses secondary model when preferSecondary=true", () => {
  const provider = buildQwenProvider(sampleProfile, true);
  assert.ok(provider !== null);
  assert.equal(provider!.maxTokens, 32768);
});

test("buildQwenProvider falls back to primary when secondary is null", () => {
  const noSecondary: QwenProfile = { ...sampleProfile, secondary: null };
  const provider = buildQwenProvider(noSecondary, true);
  assert.ok(provider !== null);
  assert.equal(provider!.maxTokens, 65536);
});

test("isQwenCodeAvailable returns false when no qwen config", () => {
  const available = withTempHome({}, () => isQwenCodeAvailable());
  assert.equal(available, false);
});

test("isQwenCodeAvailable returns true when qwen profile is configured", () => {
  const cfg = {
    qwen: {
      primary: { modelId: "qwen3-coder-80b", endpoint: "http://localhost:8080", provider: "mlx" },
    },
  };
  const available = withTempHome(cfg, () => isQwenCodeAvailable());
  assert.equal(available, true);
});
