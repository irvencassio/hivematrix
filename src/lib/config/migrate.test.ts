import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { migrateConfigObject, migrateConfig } from "./migrate";

test("migrateConfigObject drops qwen/localEngine/localModel (and their nested content)", () => {
  const cfg = {
    qwen: { location: "local", primary: { modelId: "Qwen3-Coder-Next-80B-A3B", endpoint: "http://localhost:8080" }, sampling: { temperature: 0.6 } },
    localEngine: { engine: "rapid-mlx", tiers: [{ key: "fast", alias: "qwen3.6-35b-4bit" }] },
    localModel: { provider: "lmstudio", endpoint: "http://localhost:1234", modelName: "qwen3.6-27b" },
    theme: "dark",
  };
  const { config, result } = migrateConfigObject(cfg);
  assert.equal(result.changed, true);
  assert.deepEqual(result.droppedKeys.sort(), ["localEngine", "localModel", "qwen"]);
  assert.equal("qwen" in config, false);
  assert.equal("localEngine" in config, false);
  assert.equal("localModel" in config, false);
  // Unrelated keys survive untouched.
  assert.equal(config.theme, "dark");
});

test("migrateConfigObject resets a role override that names a Qwen/local id, keeps a Claude one", () => {
  const cfg = {
    operationalModel: "qwen3.6-35b-4bit",
    thinkModel: "opus",
    frontierModel: "claude-sonnet-4-6",
    writerModel: "mlx-community/Qwen3.6-35B-A3B-8bit",
  };
  const { config, result } = migrateConfigObject(cfg);
  assert.deepEqual(result.resetRoleModels.sort(), ["operationalModel", "writerModel"]);
  assert.equal("operationalModel" in config, false, "reset → key removed (empty = resolver default)");
  assert.equal("writerModel" in config, false);
  assert.equal(config.thinkModel, "opus", "already-Claude override is left alone");
  assert.equal(config.frontierModel, "claude-sonnet-4-6", "already-Claude override is left alone");
});

test("migrateConfigObject is a no-op on an already-migrated config", () => {
  const cfg = { theme: "dark", operationalModel: "haiku", frontierModel: "sonnet" };
  const { config, result } = migrateConfigObject(cfg);
  assert.equal(result.changed, false);
  assert.deepEqual(result.droppedKeys, []);
  assert.deepEqual(result.resetRoleModels, []);
  assert.deepEqual(config, cfg);
});

test("migrateConfigObject is a no-op on an empty config", () => {
  const { result } = migrateConfigObject({});
  assert.equal(result.changed, false);
});

test("migrateConfig: end-to-end file round-trip — writes back atomically and is idempotent", (t) => {
  const home = mkdtempSync(join(tmpdir(), "hm-config-migrate-"));
  const origHome = process.env.HOME;
  process.env.HOME = home;
  t.after(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  mkdirSync(join(home, ".hivematrix"), { recursive: true });
  const cfgPath = join(home, ".hivematrix", "config.json");
  writeFileSync(cfgPath, JSON.stringify({
    qwen: { primary: { modelId: "qwen3.6-35b-4bit", endpoint: "http://localhost:8080" } },
    localEngine: { engine: "rapid-mlx" },
    operationalModel: "qwen3.6-35b-4bit",
    frontierModel: "sonnet",
    theme: "matrix",
  }));

  const first = migrateConfig();
  assert.equal(first.changed, true);
  assert.deepEqual(first.droppedKeys.sort(), ["localEngine", "qwen"]);
  assert.deepEqual(first.resetRoleModels, ["operationalModel"]);

  const onDisk = JSON.parse(readFileSync(cfgPath, "utf-8"));
  assert.equal("qwen" in onDisk, false);
  assert.equal("localEngine" in onDisk, false);
  assert.equal("operationalModel" in onDisk, false);
  assert.equal(onDisk.frontierModel, "sonnet");
  assert.equal(onDisk.theme, "matrix");

  // Idempotent: running again on the already-migrated file is a no-op.
  const second = migrateConfig();
  assert.equal(second.changed, false);
});

test("migrateConfig: missing config file is a silent no-op", (t) => {
  const home = mkdtempSync(join(tmpdir(), "hm-config-migrate-missing-"));
  const origHome = process.env.HOME;
  process.env.HOME = home;
  t.after(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });
  const result = migrateConfig();
  assert.equal(result.changed, false);
});
