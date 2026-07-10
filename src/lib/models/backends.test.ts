import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { detectBackends } from "./backends";

function withTempHome<T>(config: Record<string, unknown>, run: () => T): T {
  const originalHome = process.env.HOME;
  const tempHome = mkdtempSync(join(tmpdir(), "hive-backends-test-"));
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

const CONFIGURED_QWEN = {
  qwen: {
    location: "local",
    primary: { modelId: "qwen3.6-35b-4bit", endpoint: "http://127.0.0.1:8000/v1", provider: "mlx", contextLimit: 32768 },
  },
};

function fixture(installed: boolean, enabled: boolean) {
  return detectBackends({
    findBinary: (name) => (name === "claude" && installed ? "/fake/bin/claude" : null),
    isProviderEnabled: (id) => (id === "claude" ? enabled : false),
  });
}

test("installed=true, enabled=true -> configured=true", () => {
  const claude = fixture(true, true).find((b) => b.id === "claude")!;
  assert.equal(claude.installed, true);
  assert.equal(claude.enabled, true);
  assert.equal(claude.configured, true);
});

test("installed=true, enabled=false -> configured=false (disabled but still installed)", () => {
  const claude = fixture(true, false).find((b) => b.id === "claude")!;
  assert.equal(claude.installed, true);
  assert.equal(claude.enabled, false);
  assert.equal(claude.configured, false);
});

test("installed=false, enabled=true -> configured=false (enabled mid-setup, not installed yet)", () => {
  const claude = fixture(false, true).find((b) => b.id === "claude")!;
  assert.equal(claude.installed, false);
  assert.equal(claude.enabled, true);
  assert.equal(claude.configured, false);
});

test("installed=false, enabled=false -> configured=false", () => {
  const claude = fixture(false, false).find((b) => b.id === "claude")!;
  assert.equal(claude.installed, false);
  assert.equal(claude.enabled, false);
  assert.equal(claude.configured, false);
});

function localFixture(config: Record<string, unknown>, enabled: boolean) {
  return withTempHome(config, () =>
    detectBackends({ isProviderEnabled: () => false, isLocalEngineEnabled: () => enabled }).find((b) => b.id === "local")!,
  );
}

test("local: installed=true, enabled=true -> configured=true", () => {
  const local = localFixture(CONFIGURED_QWEN, true);
  assert.equal(local.installed, true);
  assert.equal(local.enabled, true);
  assert.equal(local.configured, true);
});

test("local: installed=true, enabled=false -> configured=false (disabled but still installed)", () => {
  const local = localFixture(CONFIGURED_QWEN, false);
  assert.equal(local.installed, true);
  assert.equal(local.enabled, false);
  assert.equal(local.configured, false);
});

test("local: installed=false, enabled=true -> configured=false (enabled but nothing configured yet)", () => {
  const local = localFixture({}, true);
  assert.equal(local.installed, false);
  assert.equal(local.enabled, true);
  assert.equal(local.configured, false);
});

test("local: installed=false, enabled=false -> configured=false", () => {
  const local = localFixture({}, false);
  assert.equal(local.installed, false);
  assert.equal(local.enabled, false);
  assert.equal(local.configured, false);
});
