import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-frontier-usage-test-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");
process.env.HOME = TMP; // so resolveModelId reads a clean config (defaults)

const { getDb, _resetDbForTests, Task } = await import("@/lib/db");
const { getFrontierUsage, isFrontierModel, _setSubscriptionReaderForTests, _setCodexUsageReaderForTests } = await import("./frontier-usage");
const { resolveModelId } = await import("@/lib/routing/model-resolver");

_resetDbForTests();
getDb();
_setSubscriptionReaderForTests(async () => ({
  usage: null,
  status: {
    state: "missing_credentials",
    message: "Subscription usage disabled in tests.",
  },
}));
_setCodexUsageReaderForTests(() => null);

test.after(() => {
  _setSubscriptionReaderForTests(null);
  _setCodexUsageReaderForTests(null);
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

test("isFrontierModel: bills for claude/gpt/codex, free for local qwen", () => {
  assert.equal(isFrontierModel("claude-opus-4-8"), true);
  assert.equal(isFrontierModel("claude-sonnet-4-6"), true);
  assert.equal(isFrontierModel("sonnet"), true, "bare Claude alias bills");
  assert.equal(isFrontierModel("opus"), true, "bare Claude alias bills");
  assert.equal(isFrontierModel("codex:gpt-5.4"), true);
  assert.equal(isFrontierModel("qwen/qwen3.6-27b"), false);
  assert.equal(isFrontierModel("nano-banana"), false);
});

test("getFrontierUsage aggregates cost/tokens and excludes local-only tasks", async () => {
  const today = new Date().toISOString();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await Task.create({ title: "opus task", description: "opus task", project: "p", projectPath: "/tmp", status: "review", executor: "agent",
    completedAt: today, output: { cost: 0.5, inputTokens: 1000, outputTokens: 200, modelsUsed: ["claude-opus-4-8"] } });
  await Task.create({ title: "sonnet task", description: "sonnet task", project: "p", projectPath: "/tmp", status: "done", executor: "agent",
    completedAt: yesterday, output: { cost: 0.1, inputTokens: 500, outputTokens: 100, modelsUsed: ["claude-sonnet-4-6"] } });
  await Task.create({ title: "local task", description: "local task", project: "p", projectPath: "/tmp", status: "done", executor: "agent",
    completedAt: today, output: { cost: 0, inputTokens: 999, outputTokens: 99, modelsUsed: ["qwen/qwen3.6-27b"] } });

  const u = await getFrontierUsage();
  assert.equal(u.taskCount, 2, "local-only task excluded");
  assert.equal(u.totalCost, 0.6);
  assert.equal(u.todayCost, 0.5);
  assert.equal(u.todayTaskCount, 1);
  assert.equal(u.inputTokens, 1500, "qwen tokens not counted");
  assert.equal(u.byModel.length, 2);
  assert.equal(u.byModel[0].label, "Opus", "sorted by cost desc");
  assert.equal(u.byModel[0].cost, 0.5);
});

test("resolveModelId maps frontier-premium to Opus", () => {
  assert.equal(resolveModelId("frontier-premium"), "opus");
  assert.equal(resolveModelId("frontier"), "sonnet");
});

test("getFrontierUsage includes Codex subscription windows when available", async () => {
  _setCodexUsageReaderForTests(() => ({
    provider: "codex",
    profile: "chatgpt",
    accountName: "Irv",
    accountEmail: "irv@example.com",
    planType: "plus",
    fiveHour: { utilization: 12, resetsAt: "2026-06-13T20:00:00.000Z" },
    sevenDay: { utilization: 34, resetsAt: "2026-06-20T20:00:00.000Z" },
    sevenDayOpus: null,
    sevenDaySonnet: null,
    extraUsage: null,
    fetchedAt: "2026-06-13T18:00:00.000Z",
  }));

  const u = await getFrontierUsage();
  assert.equal(u.codexSubscription?.provider, "codex");
  assert.equal(u.codexSubscription?.fiveHour?.utilization, 12);
  assert.equal(u.codexSubscription?.sevenDay?.utilization, 34);

  _setCodexUsageReaderForTests(() => null);
});

test("getFrontierUsage skips subscription reads for disabled providers", async () => {
  let subscriptionReaderCalled = false;
  let codexReaderCalled = false;
  _setSubscriptionReaderForTests(async () => {
    subscriptionReaderCalled = true;
    return { usage: null, status: { state: "ok", message: "should not be called" } };
  });
  _setCodexUsageReaderForTests(() => {
    codexReaderCalled = true;
    return null;
  });

  mkdirSync(join(TMP, ".hivematrix"), { recursive: true });
  writeFileSync(join(TMP, ".hivematrix", "config.json"), JSON.stringify({
    providers: { claude: { enabled: false }, codex: { enabled: false } },
  }));

  try {
    const u = await getFrontierUsage();
    assert.equal(subscriptionReaderCalled, false, "Claude subscription reader skipped when disabled");
    assert.equal(codexReaderCalled, false, "Codex usage reader skipped when disabled");
    assert.equal(u.subscriptionStatus.state, "disabled");
    assert.equal(u.subscription, null);
    assert.equal(u.codexSubscription, null);
  } finally {
    rmSync(join(TMP, ".hivematrix", "config.json"), { force: true });
  }
});

test("getFrontierUsage can bypass the Claude subscription cache", async () => {
  let bypassSeen = false;
  _setSubscriptionReaderForTests(async (options) => {
    bypassSeen = options?.bypassCache === true;
    return {
      usage: null,
      status: {
        state: "missing_refresh_token",
        message: "Claude token is expired.",
      },
    };
  });

  await getFrontierUsage({ bypassSubscriptionCache: true });
  assert.equal(bypassSeen, true);

  _setSubscriptionReaderForTests(async () => ({
    usage: null,
    status: {
      state: "missing_credentials",
      message: "Subscription usage disabled in tests.",
    },
  }));
});
