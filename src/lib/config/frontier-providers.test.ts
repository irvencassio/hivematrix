import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { FRONTIER_PROVIDERS, isProviderEnabled, setProviderEnabled, getEnabledProviders } from "./frontier-providers";

function withTempHome<T>(config: Record<string, unknown>, run: (homeDir: string) => T): T {
  const originalHome = process.env.HOME;
  const tempHome = mkdtempSync(join(tmpdir(), "hive-frontier-providers-test-"));
  mkdirSync(join(tempHome, ".hivematrix"), { recursive: true });
  writeFileSync(join(tempHome, ".hivematrix", "config.json"), JSON.stringify(config, null, 2));
  process.env.HOME = tempHome;
  try {
    return run(tempHome);
  } finally {
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
}

test("FRONTIER_PROVIDERS lists exactly claude and codex", () => {
  assert.deepEqual(FRONTIER_PROVIDERS, ["claude", "codex"]);
});

test("absent key defaults to detection result", () => {
  const detectYes = () => true;
  const detectNo = () => false;
  assert.equal(isProviderEnabled("claude", {}, detectYes), true);
  assert.equal(isProviderEnabled("claude", {}, detectNo), false);
});

test("explicit stored value wins regardless of detection", () => {
  const cfg = { providers: { claude: { enabled: false } } };
  assert.equal(isProviderEnabled("claude", cfg, () => true), false);

  const cfg2 = { providers: { codex: { enabled: true } } };
  assert.equal(isProviderEnabled("codex", cfg2, () => false), true);
});

test("getEnabledProviders filters FRONTIER_PROVIDERS by enablement", () => {
  const cfg = { providers: { claude: { enabled: true }, codex: { enabled: false } } };
  assert.deepEqual(getEnabledProviders(cfg, () => false), ["claude"]);
});

test("setProviderEnabled persists and merges without disturbing other config", () => {
  withTempHome({ existingKey: "keepme", providers: { claude: { enabled: false } } }, (home) => {
    setProviderEnabled("codex", true);
    const written = JSON.parse(readFileSync(join(home, ".hivematrix", "config.json"), "utf-8"));
    assert.equal(written.existingKey, "keepme");
    assert.equal(written.providers.claude.enabled, false);
    assert.equal(written.providers.codex.enabled, true);
  });
});
