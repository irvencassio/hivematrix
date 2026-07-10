import test from "node:test";
import assert from "node:assert/strict";
import { estimateKvCacheGiB, kvBytesPerToken, KV_SHAPE_BY_TIER } from "./local-tuning";

function approx(actual: number, expected: number, tolerance = 0.02) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

test("kvBytesPerToken: fast tier (MoE, 40 layers x 2 kv_heads x 256) at int4", () => {
  // 2 (K+V) * 40 * 2 * 256 * (0.5 + 4/64) = 23,040 bytes/token
  assert.equal(kvBytesPerToken(KV_SHAPE_BY_TIER.fast, "int4"), 23040);
});

test("kvBytesPerToken: coding tier (dense, 64 layers x 4 kv_heads x 256) at int4", () => {
  // 2 * 64 * 4 * 256 * 0.5625 = 73,728 bytes/token
  assert.equal(kvBytesPerToken(KV_SHAPE_BY_TIER.coding, "int4"), 73728);
});

test("coding tier is ~3.2x more KV-expensive per token than fast — 64x4 vs 40x2 heads", () => {
  const fast = kvBytesPerToken(KV_SHAPE_BY_TIER.fast, "int4");
  const coding = kvBytesPerToken(KV_SHAPE_BY_TIER.coding, "int4");
  approx(coding / fast, 3.2, 0.05);
});

test("estimateKvCacheGiB matches the spec's hand-computed table at 32,768 context", () => {
  approx(estimateKvCacheGiB("fast", 32768, "int4"), 0.70);
  approx(estimateKvCacheGiB("fast", 32768, "int8"), 1.33);
  approx(estimateKvCacheGiB("coding", 32768, "int4"), 2.25);
  approx(estimateKvCacheGiB("coding", 32768, "int8"), 4.25);
});

test("estimateKvCacheGiB scales linearly with context length", () => {
  const at32k = estimateKvCacheGiB("fast", 32768, "int4");
  const at65k = estimateKvCacheGiB("fast", 65536, "int4");
  approx(at65k / at32k, 2.0, 0.01);
});

test("bf16 costs roughly 3.5x int4 at the same context (no quant-group overhead on bf16)", () => {
  const int4 = estimateKvCacheGiB("coding", 65536, "int4");
  const bf16 = estimateKvCacheGiB("coding", 65536, "bf16");
  approx(bf16 / int4, 3.56, 0.05);
});
