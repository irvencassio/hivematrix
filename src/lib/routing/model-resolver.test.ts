import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// resolveModelId reads ~/.hivematrix/config.json — isolate HOME.
const TMP = mkdtempSync(join(tmpdir(), "hm-resolver-test-"));
process.env.HOME = TMP;
mkdirSync(join(TMP, ".hivematrix"), { recursive: true });
const cfgPath = join(TMP, ".hivematrix", "config.json");
const writeCfg = (o: Record<string, unknown>) => writeFileSync(cfgPath, JSON.stringify(o));

const { resolveModelId } = await import("./model-resolver");

test.after(() => rmSync(TMP, { recursive: true, force: true }));

test("frontier-premium uses thinkModel override, else Opus default", () => {
  writeCfg({});
  assert.equal(resolveModelId("frontier-premium"), "claude-opus-4-8");
  writeCfg({ thinkModel: "claude-sonnet-4-6" });
  assert.equal(resolveModelId("frontier-premium"), "claude-sonnet-4-6");
});

test("frontier uses frontierModel (coding) override, else Sonnet default", () => {
  writeCfg({});
  assert.equal(resolveModelId("frontier"), "claude-sonnet-4-6");
  writeCfg({ frontierModel: "claude-opus-4-8" });
  assert.equal(resolveModelId("frontier"), "claude-opus-4-8");
});

test("codex provider defaults thinking to GPT-5.5 and coding to Spark", () => {
  writeCfg({ frontierProvider: "codex" });
  assert.equal(resolveModelId("frontier-premium"), "codex:gpt-5.5");
  assert.equal(resolveModelId("frontier"), "codex:gpt-5.3-codex-spark");
});

test("role model overrides win even when frontier provider is Codex", () => {
  writeCfg({ frontierProvider: "codex", thinkModel: "claude-opus-4-8", frontierModel: "codex:gpt-5.5" });
  assert.equal(resolveModelId("frontier-premium"), "claude-opus-4-8");
  assert.equal(resolveModelId("frontier"), "codex:gpt-5.5");
});

test("cloud-only resolution ignores local role overrides", () => {
  writeCfg({ frontierProvider: "claude", frontierModel: "qwen/qwen3.6-27b" });
  assert.equal(resolveModelId("frontier"), "qwen/qwen3.6-27b");
  assert.equal(resolveModelId("frontier", { noLocalOverrides: true }), "claude-sonnet-4-6");
});

test("local-secondary honors operationalModel override before the Qwen profile", () => {
  writeCfg({ operationalModel: "qwen3-coder-30b" });
  assert.equal(resolveModelId("local-secondary"), "qwen3-coder-30b");
  // no override + no qwen profile → null (caller queues/skips)
  writeCfg({});
  assert.equal(resolveModelId("local-secondary"), null);
});
