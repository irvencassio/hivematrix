import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getQwenProfile, isQwenEndpointLocal } from "./qwen-profile";

function withTempHome<T>(config: Record<string, unknown>, run: () => T): T {
  const originalHome = process.env.HOME;
  const tempHome = mkdtempSync(join(tmpdir(), "hivematrix-qwen-test-"));
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

test("getQwenProfile returns null when no qwen section", () => {
  const profile = withTempHome({ providers: {} }, () => getQwenProfile());
  assert.equal(profile, null);
});

test("getQwenProfile parses full profile", () => {
  const cfg = {
    qwen: {
      location: "local",
      primary: { modelId: "Qwen3-Coder-Next-80B-A3B", endpoint: "http://localhost:8080", provider: "mlx", contextLimit: 262144 },
      secondary: { modelId: "Qwen3.6-35B-A3B", endpoint: "http://localhost:8080", provider: "mlx", contextLimit: 65536 },
      thinkingEnabled: true,
      minDecodeRate: 15,
      probeTimeoutMs: 60000,
    },
  };
  const profile = withTempHome(cfg, () => getQwenProfile());
  assert.ok(profile !== null);
  assert.equal(profile!.location, "local");
  assert.equal(profile!.primary.modelId, "Qwen3-Coder-Next-80B-A3B");
  assert.equal(profile!.primary.provider, "mlx");
  assert.equal(profile!.primary.contextLimit, 262144);
  assert.ok(profile!.secondary !== null);
  assert.equal(profile!.secondary!.modelId, "Qwen3.6-35B-A3B");
  assert.equal(profile!.thinkingEnabled, true);
  assert.equal(profile!.minDecodeRate, 15);
});

test("getQwenProfile applies defaults for missing fields", () => {
  const cfg = {
    qwen: {
      primary: { modelId: "my-model", endpoint: "http://localhost:8080", provider: "ollama" },
    },
  };
  const profile = withTempHome(cfg, () => getQwenProfile());
  assert.ok(profile !== null);
  assert.equal(profile!.location, "local");
  assert.equal(profile!.thinkingEnabled, false);
  assert.equal(profile!.minDecodeRate, 15);
  assert.equal(profile!.probeTimeoutMs, 60000);
  assert.equal(profile!.secondary, null);
});

test("getQwenProfile normalises unknown provider to mlx", () => {
  const cfg = {
    qwen: {
      primary: { modelId: "x", endpoint: "http://localhost:8080", provider: "unknown-provider" },
    },
  };
  const profile = withTempHome(cfg, () => getQwenProfile());
  assert.equal(profile!.primary.provider, "mlx");
});

test("isQwenEndpointLocal identifies loopback addresses", () => {
  assert.equal(isQwenEndpointLocal("http://localhost:8080"), true);
  assert.equal(isQwenEndpointLocal("http://127.0.0.1:8080"), true);
  assert.equal(isQwenEndpointLocal("http://[::1]:8080"), true);
  assert.equal(isQwenEndpointLocal("http://192.168.1.5:8080"), false);
  assert.equal(isQwenEndpointLocal("https://api.qwen.ai/v1"), false);
});
