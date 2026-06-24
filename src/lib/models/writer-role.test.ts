import test from "node:test";
import assert from "node:assert/strict";
import { isFrontierModelId, resolveWriterModel } from "./writer-role";

test("isFrontierModelId distinguishes frontier vs local ids", () => {
  assert.ok(isFrontierModelId("claude-sonnet-4-6"));
  assert.ok(isFrontierModelId("codex:gpt-5.5"));
  assert.ok(isFrontierModelId("gpt-5"));
  assert.ok(!isFrontierModelId("mlx-community/Qwen3.6-35B-A3B-4bit"));
  assert.ok(!isFrontierModelId(""));
});

test("a local pick locks writing to local, even when cloud is available", () => {
  const w = resolveWriterModel({ canUseCloud: true, writerModel: "mlx-community/Qwen3.6-35B-A3B-4bit" });
  assert.equal(w.provider, "local");
  assert.equal(w.lockedLocal, true);
  assert.equal(w.modelId, "mlx-community/Qwen3.6-35B-A3B-4bit");
});

test("offline falls back to local even with a frontier pick", () => {
  const w = resolveWriterModel({ canUseCloud: false, writerModel: "claude-opus-4-8" });
  assert.equal(w.provider, "local");
  assert.equal(w.lockedLocal, false);
});

test("a chosen frontier model is used when cloud-ok", () => {
  const w = resolveWriterModel({ canUseCloud: true, writerModel: "claude-opus-4-8" });
  assert.equal(w.provider, "anthropic");
  assert.equal(w.modelId, "claude-opus-4-8");
  assert.equal(w.lockedLocal, false);
});

test("a codex frontier pick resolves to the codex provider", () => {
  const w = resolveWriterModel({ canUseCloud: true, writerModel: "codex:gpt-5.5" });
  assert.equal(w.provider, "codex");
  assert.equal(w.modelId, "codex:gpt-5.5");
});

test("default (unset) writes via frontier when cloud-ok (not local)", () => {
  const w = resolveWriterModel({ canUseCloud: true, writerModel: "" });
  assert.notEqual(w.provider, "local"); // a frontier favorite, exact id depends on config
  assert.ok(w.modelId, "resolves to some frontier model id");
});
