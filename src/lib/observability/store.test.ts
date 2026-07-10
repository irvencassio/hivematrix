import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Isolate HOME so the DB (and any config) is a fresh temp instance.
const TMP = mkdtempSync(join(tmpdir(), "hm-obs-test-"));
process.env.HOME = TMP;
mkdirSync(join(TMP, ".hivematrix"), { recursive: true });

const { recordRun, listTaskTelemetry, getTaskTelemetry, observabilitySummary } = await import("./store");
const { getDb } = await import("@/lib/db");

test.after(() => rmSync(TMP, { recursive: true, force: true }));

test("recordRun persists a normalized row and rolls up usage_totals", () => {
  recordRun({
    taskId: "task-1", runIndex: 0, model: "claude-opus-4-8", status: "done",
    inputTokens: 1000, outputTokens: 500, costUsd: 0.05, project: "demo",
    startedAtMs: 0, completedAtMs: 2000,
  });
  recordRun({
    taskId: "task-2", runIndex: 0, model: "qwen3-coder-30b", status: "done",
    inputTokens: 200, outputTokens: 800, costUsd: 0, project: "demo",
    startedAtMs: 0, completedAtMs: 4000,
  });
  recordRun({
    taskId: "task-3", runIndex: 0, model: "codex:gpt-5.5-codex", status: "done",
    inputTokens: 0, outputTokens: 0, project: "demo",
  });
  recordRun({
    taskId: "task-4", runIndex: 0, model: "qwen3.6-35b-4bit", status: "done",
    inputTokens: 120, outputTokens: 480, costUsd: 0, project: "demo",
    startedAtMs: 0, completedAtMs: 3000,
  });

  const recent = listTaskTelemetry(10);
  assert.equal(recent.length, 4);

  // Codex row stored tokens as NULL (unavailable), not 0.
  const codex = recent.find((r) => r.provider === "openai-codex")!;
  assert.equal(codex.inputTokens, null);
  assert.equal(codex.costUsd, null);

  // Local row: cost null, tokens/sec computed.
  const qwen = recent.find((r) => r.taskId === "task-2")!;
  assert.equal(qwen.costUsd, null);
  assert.equal(qwen.tokensPerSec, 200); // 800 / 4s

  // usage_totals rolled up by provider.
  const totals = getDb().prepare("SELECT profile, taskCount, cost, inputTokens FROM usage_totals ORDER BY profile").all() as Array<Record<string, number>>;
  const anthropic = totals.find((t) => (t.profile as unknown as string) === "anthropic")!;
  assert.equal(anthropic.taskCount, 1);
  assert.equal(anthropic.cost, 0.05);
  assert.equal(anthropic.inputTokens, 1000);
});

test("getTaskTelemetry returns each run for a task in order", () => {
  recordRun({ taskId: "multi", runIndex: 0, model: "claude-opus-4-8", status: "failed", inputTokens: 10, outputTokens: 5 });
  recordRun({ taskId: "multi", runIndex: 1, model: "claude-opus-4-8", status: "done", inputTokens: 20, outputTokens: 10 });
  const runs = getTaskTelemetry("multi");
  assert.equal(runs.length, 2);
  assert.equal(runs[0].runIndex, 0);
  assert.equal(runs[1].runIndex, 1);
  assert.equal(runs[1].status, "done");
});

test("observabilitySummary aggregates across providers", () => {
  const s = observabilitySummary();
  assert.ok(s.runs >= 5);
  assert.ok(s.byProvider.some((p) => p.key === "anthropic"));
  assert.ok(s.byProvider.some((p) => p.key === "local-qwen"));
  assert.ok(s.split.local >= 1 && s.split.frontier >= 1);
  // Codex task was recorded with 0/0 tokens (= unavailable). The aggregate must
  // surface null, not 0, so the UI shows "—" rather than a misleading "0 / 0".
  const codex = s.byProvider.find((p) => p.key === "openai-codex")!;
  assert.ok(codex, "openai-codex row present when codex tasks exist");
  assert.equal(codex.inputTokens, null, "unavailable Codex tokens → null in summary, not 0");
  assert.equal(codex.outputTokens, null);
});

test("observabilitySummary: no isAllowed filter → hiddenProviders is empty and all rows count", () => {
  const s = observabilitySummary();
  assert.deepEqual(s.hiddenProviders, []);
});

test("observabilitySummary: isAllowed filters BOTH byProvider/split/tokens AND reports what it hid", () => {
  recordRun({ taskId: "hide-1", runIndex: 0, model: "codex:gpt-5.5-codex", status: "done", inputTokens: 4000, outputTokens: 1000 });
  const allowAll = observabilitySummary(1000);
  const hideCodex = observabilitySummary(1000, (p) => p !== "openai-codex");

  // Derive expected deltas from the actual codex row rather than assuming
  // exactly one codex row exists — earlier tests in this shared-DB file may
  // have already recorded one.
  const codexRow = allowAll.byProvider.find((p) => p.key === "openai-codex")!;
  assert.ok(codexRow, "sanity: codex row exists before filtering");
  assert.ok(!hideCodex.byProvider.some((p) => p.key === "openai-codex"), "hidden provider excluded from byProvider");

  // The headline totals must be filtered BEFORE aggregation, not after — this
  // is the bug this feature exists to prevent (a disabled provider still
  // inflating tokens.total/split because only scorecard/recent were filtered).
  assert.equal(hideCodex.runs, allowAll.runs - codexRow.runs);
  assert.equal(hideCodex.tokens.input, allowAll.tokens.input - (codexRow.inputTokens ?? 0));
  assert.equal(hideCodex.tokens.output, allowAll.tokens.output - (codexRow.outputTokens ?? 0));

  // ...but it must be reported, not silently dropped.
  const hidden = hideCodex.hiddenProviders.find((h) => h.key === "openai-codex");
  assert.ok(hidden, "hidden provider must be reported in hiddenProviders");
  assert.equal(hidden!.runs, codexRow.runs);
});
