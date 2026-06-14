import test from "node:test";
import assert from "node:assert/strict";
import {
  providerForModel,
  normalizeRun,
  summarizeTelemetry,
  percentile,
  type RunTelemetryInput,
} from "./contracts";

test("providerForModel maps each runner correctly", () => {
  assert.equal(providerForModel("claude-opus-4-8"), "anthropic");
  assert.equal(providerForModel("claude-sonnet-4-6"), "anthropic");
  assert.equal(providerForModel("codex:gpt-5.5-codex"), "openai-codex");
  assert.equal(providerForModel("gpt-5.5"), "openai-codex");
  assert.equal(providerForModel("qwen3-coder-30b"), "local-qwen");
  assert.equal(providerForModel("mistral-small"), "local-qwen");
  assert.equal(providerForModel(""), "other");
  assert.equal(providerForModel(null), "other");
});

const base: RunTelemetryInput = {
  taskId: "t1", runIndex: 0, model: "claude-opus-4-8", status: "done",
  startedAtMs: 1000, completedAtMs: 5000, firstTokenAtMs: 1800,
};

test("Claude run: tokens + cost pass through, latency/ttft/tokens-per-sec computed", () => {
  const r = normalizeRun({ ...base, inputTokens: 1200, outputTokens: 800, cacheReadTokens: 300, costUsd: 0.042, turns: 3 });
  assert.equal(r.provider, "anthropic");
  assert.equal(r.inputTokens, 1200);
  assert.equal(r.outputTokens, 800);
  assert.equal(r.totalTokens, 1200 + 800 + 300);
  assert.equal(r.latencyMs, 4000);
  assert.equal(r.ttftMs, 800);
  assert.equal(r.tokensPerSec, 200); // 800 / 4s
  assert.equal(r.costUsd, 0.042);
});

test("Codex with 0/0 tokens is recorded as UNAVAILABLE (null), never a fake 0", () => {
  const r = normalizeRun({ ...base, model: "codex:gpt-5.5-codex", inputTokens: 0, outputTokens: 0, costUsd: 0 });
  assert.equal(r.provider, "openai-codex");
  assert.equal(r.inputTokens, null, "no fake 0");
  assert.equal(r.outputTokens, null);
  assert.equal(r.totalTokens, null);
  assert.equal(r.costUsd, null);
});

test("Codex with recovered tokens reports them; cost stays null (not reported)", () => {
  const r = normalizeRun({ ...base, model: "codex:gpt-5.5-codex", inputTokens: 4000, outputTokens: 1500, costUsd: 0 });
  assert.equal(r.inputTokens, 4000);
  assert.equal(r.outputTokens, 1500);
  assert.equal(r.totalTokens, 5500);
  assert.equal(r.costUsd, null, "Codex cost is not provider-reported");
});

test("Local Qwen: tokens through, cost is null (free, not 0), tokens/sec computed", () => {
  const r = normalizeRun({ ...base, model: "qwen3-coder-30b", inputTokens: 500, outputTokens: 2000, costUsd: 0.99 });
  assert.equal(r.provider, "local-qwen");
  assert.equal(r.outputTokens, 2000);
  assert.equal(r.costUsd, null, "local is free — null, never a fabricated cost");
  assert.equal(r.tokensPerSec, 500); // 2000 / 4s
});

test("missing timestamps → latency/ttft/tokens-per-sec are null, not 0", () => {
  const r = normalizeRun({ taskId: "t", runIndex: 0, model: "claude-opus-4-8", status: "done", outputTokens: 100 });
  assert.equal(r.latencyMs, null);
  assert.equal(r.ttftMs, null);
  assert.equal(r.tokensPerSec, null);
});

test("percentile: nearest-rank, empty → null", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([10], 95), 10);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
});

test("summarizeTelemetry: provider split, latency p50/p95, totals exclude nulls", () => {
  const rows = [
    normalizeRun({ taskId: "a", runIndex: 0, model: "claude-opus-4-8", status: "done", inputTokens: 100, outputTokens: 100, costUsd: 0.01, startedAtMs: 0, completedAtMs: 1000 }),
    normalizeRun({ taskId: "b", runIndex: 0, model: "claude-opus-4-8", status: "failed", inputTokens: 200, outputTokens: 50, costUsd: 0.02, startedAtMs: 0, completedAtMs: 3000 }),
    normalizeRun({ taskId: "c", runIndex: 0, model: "qwen3-coder", status: "done", inputTokens: 10, outputTokens: 90, startedAtMs: 0, completedAtMs: 2000 }),
    normalizeRun({ taskId: "d", runIndex: 0, model: "codex:gpt-5.5-codex", status: "done", inputTokens: 0, outputTokens: 0 }),
  ];
  const s = summarizeTelemetry(rows);
  assert.equal(s.runs, 4);
  assert.equal(s.split.local, 1);
  assert.equal(s.split.frontier, 3);
  // Codex row's null tokens excluded from totals
  assert.equal(s.tokens.input, 100 + 200 + 10);
  assert.equal(s.tokens.output, 100 + 50 + 90);
  // Cost only from the two Claude rows
  assert.equal(s.costUsd, 0.03);
  const anthropic = s.byProvider.find((p) => p.key === "anthropic")!;
  assert.equal(anthropic.runs, 2);
  assert.equal(anthropic.succeeded, 1);
  assert.equal(anthropic.failed, 1);
  assert.equal(anthropic.latencyP50Ms, 1000);
  assert.equal(anthropic.latencyP95Ms, 3000);
});
