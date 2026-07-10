/**
 * KV-cache arithmetic for the two resident Rapid-MLX tiers — the numbers
 * behind the 2026-07-09 local-model-tuning spec's context/footprint
 * calculations, reused by preset derivation, the context governor, and the
 * Settings UI footprint readout so all three cite the same formula instead of
 * three hand-copied constants.
 *
 * Model shapes (layers/kv_heads/head_dim) are read from each model's HF
 * `config.json` (`max_position_embeddings`, `num_hidden_layers`,
 * `num_key_value_heads`, `head_dim`), probed 2026-07-09 — see the spec's §0.2
 * for provenance, mirroring how `local-quant.ts` documents `downloadGiB`.
 */

import type { TierKey } from "./local-engine";

export type KvCacheDtype = "int4" | "int8" | "bf16";
export const KV_CACHE_DTYPES: KvCacheDtype[] = ["int4", "int8", "bf16"];

/** Rapid-MLX serve default (`--kv-cache-dtype`, R15 #300) — Apple Silicon
 * decode is memory-bandwidth-bound, so int4 is the right default for
 * everything except hard reasoning/math. See buildServeArgs' `--reasoning`
 * interaction note in local-engine.ts. */
export const DEFAULT_KV_CACHE_DTYPE: KvCacheDtype = "int4";

/** Bytes per cached element at affine quantization group_size=64: the raw
 * element width plus a 4-byte (fp16 scale + fp16 bias) / 64-element overhead.
 * bf16 carries no quant group, hence no overhead term. */
const BYTES_PER_ELEM: Record<KvCacheDtype, number> = {
  int4: 0.5 + 4 / 64,
  int8: 1.0 + 4 / 64,
  bf16: 2.0,
};

export interface ModelKvShape {
  layers: number;
  kvHeads: number;
  headDim: number;
}

/** Per-tier KV shape for the two models this deployment resides on
 * (mlx-community/Qwen3.6-35B-A3B-* and mlx-community/Qwen3.6-27B-*). Constant
 * across quant — quantizing weights doesn't change the attention shape. */
export const KV_SHAPE_BY_TIER: Record<TierKey, ModelKvShape> = {
  fast: { layers: 40, kvHeads: 2, headDim: 256 }, // Qwen3.6-35B-A3B (MoE)
  coding: { layers: 64, kvHeads: 4, headDim: 256 }, // Qwen3.6-27B (dense)
};

/** KV bytes for one cached token: 2 (K+V) × layers × kv_heads × head_dim × dtype width. */
export function kvBytesPerToken(shape: ModelKvShape, dtype: KvCacheDtype): number {
  return 2 * shape.layers * shape.kvHeads * shape.headDim * BYTES_PER_ELEM[dtype];
}

/** KV cache footprint, in GiB, for `contextTokens` tokens at full occupancy. */
export function estimateKvCacheGiB(tier: TierKey, contextTokens: number, dtype: KvCacheDtype): number {
  const bytes = kvBytesPerToken(KV_SHAPE_BY_TIER[tier], dtype) * contextTokens;
  return bytes / 1024 ** 3;
}
