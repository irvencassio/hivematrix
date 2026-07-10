import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getLocalEngineConfig, buildServeArgs, localTargetForRole, tierBaseUrl, tierForAlias, DEFAULT_TIERS,
  localEngineCapability, memoryTierForGB, selectLocalMemoryPreset, resolveRapidBinary,
  isLocalEngineEnabled, setLocalEngineEnabled, getLocalEngineSelection, setLocalEngineSelection,
  getLocalEngineTuning, setLocalEngineTuning, validateTuning,
} from "./local-engine";

function withTempHome<T>(config: Record<string, unknown>, run: (homeDir: string) => T): T {
  const originalHome = process.env.HOME;
  const tempHome = mkdtempSync(join(tmpdir(), "hive-local-engine-test-"));
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

test("defaults: rapid-mlx engine, fast + coding tiers, reasoning OFF", () => {
  const c = getLocalEngineConfig({});
  assert.equal(c.engine, "rapid-mlx");
  assert.deepEqual(c.tiers.map((t) => t.key), ["fast", "coding"]);
  assert.equal(c.tiers[0].alias, "qwen3.6-35b-4bit");
  assert.equal(c.tiers[1].alias, "qwen3.6-27b-4bit");
  assert.ok(c.tiers.every((t) => t.reasoning === false));
});

test("configured localEngine tiers are authoritative when present", () => {
  const c = getLocalEngineConfig({
    localEngine: {
      engine: "rapid-mlx",
      binary: "/x/rapid-mlx",
      tiers: [{ key: "fast", alias: "my-fast", port: 9000, reasoning: true }],
    },
  });
  assert.equal(c.binary, "/x/rapid-mlx");
  assert.deepEqual(c.tiers.map((t) => t.key), ["fast"]);
  assert.equal(c.tiers[0].alias, "my-fast");
  assert.equal(c.tiers[0].port, 9000);
  assert.equal(c.tiers[0].reasoning, true);
});

test("getLocalEngineConfig persists a configured kvCacheDtype and cacheMemoryPercent", () => {
  const c = getLocalEngineConfig({
    localEngine: {
      tiers: [{ key: "coding", alias: "qwen3.6-27b-8bit", port: 8001, reasoning: false, kvCacheDtype: "int8", cacheMemoryPercent: 0.3 }],
    },
  });
  assert.equal(c.tiers[0].kvCacheDtype, "int8");
  assert.equal(c.tiers[0].cacheMemoryPercent, 0.3);
});

test("getLocalEngineConfig falls back to the default kvCacheDtype (int4) when unset", () => {
  const c = getLocalEngineConfig({
    localEngine: { tiers: [{ key: "fast", alias: "my-fast", port: 9000, reasoning: false }] },
  });
  assert.equal(c.tiers[0].kvCacheDtype, "int4");
});

test("buildServeArgs adds --no-thinking + --kv-cache-dtype when reasoning off", () => {
  assert.deepEqual(buildServeArgs(DEFAULT_TIERS[0]),
    ["serve", "qwen3.6-35b-4bit", "--host", "127.0.0.1", "--port", "8000", "--no-thinking", "--kv-cache-dtype", "int4"]);
});

test("buildServeArgs omits --no-thinking and --kv-cache-dtype, adds --reasoning, when reasoning on", () => {
  // --reasoning pins int8 server-side regardless of kvCacheDtype, so a
  // configured dtype is advisory only and must not be printed as if it took effect.
  assert.deepEqual(
    buildServeArgs({ key: "fast", alias: "m", port: 1, reasoning: true, kvCacheDtype: "int4" }),
    ["serve", "m", "--host", "127.0.0.1", "--port", "1", "--reasoning"],
  );
});

test("buildServeArgs omits --kv-cache-dtype when unset (defers to Rapid-MLX's own default)", () => {
  assert.deepEqual(
    buildServeArgs({ key: "fast", alias: "m", port: 1, reasoning: false }),
    ["serve", "m", "--host", "127.0.0.1", "--port", "1", "--no-thinking"],
  );
});

test("buildServeArgs passes --cache-memory-percent when configured", () => {
  assert.deepEqual(
    buildServeArgs({ key: "coding", alias: "m", port: 1, reasoning: false, kvCacheDtype: "int8", cacheMemoryPercent: 0.3 }),
    ["serve", "m", "--host", "127.0.0.1", "--port", "1", "--no-thinking", "--kv-cache-dtype", "int8", "--cache-memory-percent", "0.3"],
  );
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

test("tierForAlias resolves a not-yet-configured quant by its short alias", () => {
  const c = getLocalEngineConfig({}); // default config only has the 4-bit aliases
  const t = tierForAlias("qwen3.6-35b-8bit", c);
  assert.equal(t?.key, "fast");
  assert.equal(t?.port, 8000); // takes the fast tier's actual configured port
  assert.equal(t?.quant, "8bit");
});

test("tierForAlias resolves the full HF repo id form", () => {
  const c = getLocalEngineConfig({});
  const t = tierForAlias("mlx-community/Qwen3.6-27B-6bit", c);
  assert.equal(t?.key, "coding");
  assert.equal(t?.port, 8001);
  assert.equal(t?.quant, "6bit");
});

test("isLocalEngineEnabled: absent key defaults to the detect() probe", () => {
  assert.equal(isLocalEngineEnabled({}, () => true), true);
  assert.equal(isLocalEngineEnabled({}, () => false), false);
});

test("isLocalEngineEnabled: explicit stored value wins regardless of detection", () => {
  assert.equal(isLocalEngineEnabled({ localEngine: { enabled: false } }, () => true), false);
  assert.equal(isLocalEngineEnabled({ localEngine: { enabled: true } }, () => false), true);
});

test("getLocalEngineSelection: absent key -> {}", () => {
  assert.deepEqual(getLocalEngineSelection({}), {});
});

test("getLocalEngineSelection: only recognizes valid catalog quants, drops garbage", () => {
  const sel = getLocalEngineSelection({ localEngine: { selection: { fast: "8bit", coding: "9bit", bogus: "8bit" } } });
  assert.deepEqual(sel, { fast: "8bit" });
});

test("setLocalEngineSelection: a tier omitted from the patch leaves the other tier's pick untouched", () => {
  withTempHome({ localEngine: { selection: { fast: "4bit", coding: "6bit" } } }, (home) => {
    setLocalEngineSelection({ fast: "8bit" }); // coding not mentioned
    const written = JSON.parse(readFileSync(join(home, ".hivematrix", "config.json"), "utf-8"));
    assert.deepEqual(written.localEngine.selection, { fast: "8bit", coding: "6bit" });
  });
});

test("setLocalEngineSelection: a tier explicitly set to null deselects it (removed, not stored as null)", () => {
  withTempHome({ localEngine: { selection: { fast: "4bit", coding: "6bit" } } }, (home) => {
    setLocalEngineSelection({ coding: null });
    const written = JSON.parse(readFileSync(join(home, ".hivematrix", "config.json"), "utf-8"));
    assert.deepEqual(written.localEngine.selection, { fast: "4bit" });
    assert.ok(!("coding" in written.localEngine.selection));
  });
});

test("setLocalEngineSelection: preserves enabled/binary/tiers — only touches `selection`", () => {
  withTempHome({ localEngine: { enabled: true, binary: "/x/rapid-mlx", tiers: [{ key: "fast", alias: "qwen3.6-35b-4bit", port: 8000, reasoning: false }] } }, (home) => {
    setLocalEngineSelection({ fast: "8bit" });
    const written = JSON.parse(readFileSync(join(home, ".hivematrix", "config.json"), "utf-8"));
    assert.equal(written.localEngine.enabled, true);
    assert.equal(written.localEngine.binary, "/x/rapid-mlx");
    assert.equal(written.localEngine.tiers.length, 1);
  });
});

test("getLocalEngineTuning: absent key -> {}", () => {
  withTempHome({}, () => {
    assert.deepEqual(getLocalEngineTuning(), {});
  });
});

test("setLocalEngineTuning: a tier omitted from the patch leaves the other tier's override untouched", () => {
  withTempHome({ localEngine: { tuning: { fast: { kvCacheDtype: "int8" } } } }, () => {
    setLocalEngineTuning({ coding: { contextLimit: 16384 } });
    const merged = getLocalEngineTuning();
    assert.equal(merged.fast?.kvCacheDtype, "int8");
    assert.equal(merged.coding?.contextLimit, 16384);
  });
});

test("setLocalEngineTuning: a tier explicitly set to null clears its override (removed, not stored as null)", () => {
  withTempHome({ localEngine: { tuning: { fast: { kvCacheDtype: "int8" }, coding: { contextLimit: 16384 } } } }, () => {
    setLocalEngineTuning({ fast: null });
    const merged = getLocalEngineTuning();
    assert.equal(merged.fast, undefined);
    assert.equal(merged.coding?.contextLimit, 16384);
  });
});

test("setLocalEngineTuning: setting only kvCacheDtype doesn't clobber a stored contextLimit for the same tier", () => {
  withTempHome({ localEngine: { tuning: { fast: { contextLimit: 32768 } } } }, () => {
    setLocalEngineTuning({ fast: { kvCacheDtype: "bf16" } });
    const merged = getLocalEngineTuning();
    assert.equal(merged.fast?.contextLimit, 32768);
    assert.equal(merged.fast?.kvCacheDtype, "bf16");
  });
});

test("validateTuning: accepts a contextLimit within the tier's maxRecommendedContext and an in-range kvCacheDtype", () => {
  const preset = selectLocalMemoryPreset({ ramGB: 128 });
  const result = validateTuning({ fast: { contextLimit: 65536, kvCacheDtype: "int8" } }, preset);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.tuning.fast, { contextLimit: 65536, kvCacheDtype: "int8" });
});

test("validateTuning: rejects a contextLimit above the tier's maxRecommendedContext", () => {
  const preset = selectLocalMemoryPreset({ ramGB: 32 }); // fast maxRecommendedContext = 32768
  const result = validateTuning({ fast: { contextLimit: 999_999 } }, preset);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /contextLimit for fast/);
});

test("validateTuning: rejects a contextLimit below 1024", () => {
  const preset = selectLocalMemoryPreset({ ramGB: 128 });
  const result = validateTuning({ fast: { contextLimit: 512 } }, preset);
  assert.equal(result.ok, false);
});

test("validateTuning: rejects an unknown kvCacheDtype", () => {
  const preset = selectLocalMemoryPreset({ ramGB: 128 });
  const result = validateTuning({ coding: { kvCacheDtype: "fp32" } }, preset);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /invalid kvCacheDtype/);
});

test("validateTuning: null explicitly clears a tier's override", () => {
  const preset = selectLocalMemoryPreset({ ramGB: 128 });
  const result = validateTuning({ fast: null }, preset);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.tuning.fast, null);
});

test("setLocalEngineEnabled persists and merges without disturbing other localEngine keys", () => {
  withTempHome(
    { existingKey: "keepme", localEngine: { engine: "rapid-mlx", binary: "/x/rapid-mlx" } },
    (home) => {
      setLocalEngineEnabled(false);
      const written = JSON.parse(readFileSync(join(home, ".hivematrix", "config.json"), "utf-8"));
      assert.equal(written.existingKey, "keepme");
      assert.equal(written.localEngine.binary, "/x/rapid-mlx");
      assert.equal(written.localEngine.enabled, false);
    },
  );
});

test("memory tiers select explicit Qwen presets", () => {
  assert.equal(memoryTierForGB(16), "less_than_32gb");
  assert.equal(memoryTierForGB(32), "32gb");
  assert.equal(memoryTierForGB(48), "48gb");
  assert.equal(memoryTierForGB(64), "64gb");
  assert.equal(memoryTierForGB(128), "128gb");
  assert.equal(selectLocalMemoryPreset({ ramGB: 32 }).localAgentFast.model, "qwen3.6-35b-a3b");
  assert.equal(selectLocalMemoryPreset({ ramGB: 128 }).localCoderQuality.quant, "8bit");
  assert.equal(selectLocalMemoryPreset({ ramGB: 128 }).localCoderQuality.kvCacheDtype, "int8");
  assert.equal(selectLocalMemoryPreset({ ramGB: 128 }).localAgentFast.quant, "8bit");
  assert.equal(selectLocalMemoryPreset({ ramGB: 128 }).localAgentFast.kvCacheDtype, "int4");
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

test("capability: 32 GB → fast Qwen agent tier only", () => {
  const cap = localEngineCapability({ arch: "arm64", ramGB: 32 });
  assert.equal(cap.localCapable, true);
  assert.equal(cap.presetId, "32gb");
  assert.equal(cap.mode, "local_agent_light");
  assert.deepEqual(cap.recommendedTiers, ["fast"]);
  assert.equal(cap.tiers.find((t) => t.key === "fast")!.residentCapable, true);
  assert.equal(cap.tiers.find((t) => t.key === "coding")!.residentCapable, false);
});

test("capability: 48 GB → fast Qwen agent tier only", () => {
  const cap = localEngineCapability({ arch: "arm64", ramGB: 48 });
  assert.equal(cap.localCapable, true);
  assert.equal(cap.presetId, "48gb");
  assert.deepEqual(cap.recommendedTiers, ["fast"]);
  const coding = cap.tiers.find((t) => t.key === "coding")!;
  assert.equal(coding.capable, false);
  assert.equal(coding.residentCapable, false);
  assert.match(coding.reason ?? "", /Disabled by default/);
});

test("capability: 64 GB → both tiers resident", () => {
  const cap = localEngineCapability({ arch: "arm64", ramGB: 64 });
  assert.equal(cap.localCapable, true);
  assert.equal(cap.presetId, "64gb");
  assert.deepEqual(cap.recommendedTiers, ["fast", "coding"]);
  assert.ok(cap.tiers.every((t) => t.capable && t.residentCapable));
});

test("resolveRapidBinary prefers cfg.binary over everything else", () => {
  const cfg = getLocalEngineConfig({ localEngine: { binary: "/configured/rapid-mlx" } });
  const found = resolveRapidBinary(cfg, {
    exists: (p) => p === "/configured/rapid-mlx",
    findOnPath: () => "/should-not-be-used",
  });
  assert.equal(found, "/configured/rapid-mlx");
});

test("resolveRapidBinary prefers HIVE_RAPID_MLX over PATH when cfg.binary is unset", () => {
  const cfg = getLocalEngineConfig({});
  const found = resolveRapidBinary(cfg, {
    hiveEnv: "/env/rapid-mlx",
    exists: (p) => p === "/env/rapid-mlx",
    findOnPath: () => "/should-not-be-used",
  });
  assert.equal(found, "/env/rapid-mlx");
});

test("resolveRapidBinary finds a binary that is only on PATH", () => {
  const cfg = getLocalEngineConfig({});
  const found = resolveRapidBinary(cfg, {
    exists: () => false,
    listPythonVersions: () => [],
    findOnPath: (name) => (name === "rapid-mlx" ? "/usr/local/bin/rapid-mlx" : null),
  });
  assert.equal(found, "/usr/local/bin/rapid-mlx");
});

test("resolveRapidBinary finds a pip --user install under ~/Library/Python/<ver>/bin", () => {
  const cfg = getLocalEngineConfig({});
  const found = resolveRapidBinary(cfg, {
    home: "/Users/test",
    listPythonVersions: (base) => (base === "/Users/test/Library/Python" ? ["3.12"] : []),
    exists: (p) => p === "/Users/test/Library/Python/3.12/bin/rapid-mlx",
    findOnPath: (name, searchPaths) => searchPaths.find((p) => p.endsWith("3.12/bin/rapid-mlx")) ?? null,
  });
  assert.equal(found, "/Users/test/Library/Python/3.12/bin/rapid-mlx");
});

test("resolveRapidBinary returns null when nothing resolves", () => {
  const cfg = getLocalEngineConfig({});
  const found = resolveRapidBinary(cfg, {
    exists: () => false,
    listPythonVersions: () => [],
    findOnPath: () => null,
  });
  assert.equal(found, null);
});

test("capability: 128 GB → dual local quality preset", () => {
  const cap = localEngineCapability({ arch: "arm64", ramGB: 128 });
  assert.equal(cap.localCapable, true);
  assert.equal(cap.presetId, "128gb");
  assert.equal(cap.mode, "dual_local_quality");
  assert.deepEqual(cap.recommendedTiers, ["fast", "coding"]);
});
