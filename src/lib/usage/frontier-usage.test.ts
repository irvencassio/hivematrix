import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-frontier-usage-test-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");
process.env.HOME = TMP; // so resolveModelId reads a clean config (defaults)

const { getDb, _resetDbForTests, Task } = await import("@/lib/db");
const { getFrontierUsage, isFrontierModel } = await import("./frontier-usage");
const { resolveModelId } = await import("@/lib/routing/model-resolver");

_resetDbForTests();
getDb();

test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

test("isFrontierModel: bills for claude/gpt/codex, free for local qwen", () => {
  assert.equal(isFrontierModel("claude-opus-4-8"), true);
  assert.equal(isFrontierModel("claude-sonnet-4-6"), true);
  assert.equal(isFrontierModel("codex:gpt-5.4"), true);
  assert.equal(isFrontierModel("qwen/qwen3.6-27b"), false);
  assert.equal(isFrontierModel("nano-banana"), false);
});

test("getFrontierUsage aggregates cost/tokens and excludes local-only tasks", async () => {
  await Task.create({ title: "opus task", description: "opus task", project: "p", projectPath: "/tmp", status: "review", executor: "agent",
    output: { cost: 0.5, inputTokens: 1000, outputTokens: 200, modelsUsed: ["claude-opus-4-8"] } });
  await Task.create({ title: "sonnet task", description: "sonnet task", project: "p", projectPath: "/tmp", status: "done", executor: "agent",
    output: { cost: 0.1, inputTokens: 500, outputTokens: 100, modelsUsed: ["claude-sonnet-4-6"] } });
  await Task.create({ title: "local task", description: "local task", project: "p", projectPath: "/tmp", status: "done", executor: "agent",
    output: { cost: 0, inputTokens: 999, outputTokens: 99, modelsUsed: ["qwen/qwen3.6-27b"] } });

  const u = await getFrontierUsage();
  assert.equal(u.taskCount, 2, "local-only task excluded");
  assert.equal(u.totalCost, 0.6);
  assert.equal(u.inputTokens, 1500, "qwen tokens not counted");
  assert.equal(u.byModel.length, 2);
  assert.equal(u.byModel[0].label, "Opus", "sorted by cost desc");
  assert.equal(u.byModel[0].cost, 0.5);
});

test("resolveModelId maps frontier-premium to Opus", () => {
  assert.equal(resolveModelId("frontier-premium"), "claude-opus-4-8");
  assert.equal(resolveModelId("frontier"), "claude-sonnet-4-6");
});
