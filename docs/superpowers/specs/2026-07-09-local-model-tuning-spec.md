# Local Model Tuning: Context, KV Cache, and Sampling

## Context

The operator asked two questions: *"how do we know the context size is optimum?"*
and *"what else can be tuned?"*

The honest answer to the first is **we don't, and we can't** — because the number
HiveMatrix computes for context never reaches the inference server, and is
instead misused as a generation cap. The answer to the second is that Rapid-MLX
exposes ~50 serve flags and HiveMatrix passes four of them.

This spec fixes the bug, gives the operator a real context control modeled on how
LM Studio presents these settings, and passes through the two serve flags that
measurably matter on this hardware. It deliberately does *not* touch the flags
whose defaults are already correct.

---

## 0. Verified facts (probed on this machine, 2026-07-09 — do not re-litigate)

Everything below was confirmed by running `rapid-mlx serve --help`, `rapid-mlx
info`, `rapid-mlx ps`, and reading the HF `config.json` of each served model.
**Four of these contradict assumptions in the current code or in the analysis
that preceded this spec.**

### 0.1 `rapid-mlx serve` has no context-size flag — **this is the root of the confusion**

```
$ rapid-mlx serve --help | grep -iE "context|max-model-len|num-ctx|seq-len"
(nothing)
```

There is no `--max-model-len` (vLLM), no `--num-ctx` (Ollama), no
`contextLength` (LM Studio). This is not an oversight in Rapid-MLX — MLX grows
the KV cache lazily as tokens arrive, so there is no buffer to pre-size. Memory
is bounded by *KV dtype* and by *how many tokens you send*, not by a declared
window.

**Consequence: context size is a client-side concern.** If HiveMatrix wants a
context limit, HiveMatrix must enforce it before the request leaves.

### 0.2 Both models declare a 262,144-token context

From `~/.cache/huggingface/hub/**/config.json`:

| Model | `max_position_embeddings` | layers | kv_heads | head_dim |
|---|---|---|---|---|
| Qwen3.6-35B-A3B (fast) | 262,144 | 40 | 2 | 256 |
| Qwen3.6-27B (coding) | 262,144 | 64 | 4 | 256 |

So the server will happily accept a 262k-token prompt. Nothing in HiveMatrix
stops it. The failure mode of a runaway agent conversation is memory pressure and
swap, **not** an HTTP error — which is why it has never been noticed.

### 0.3 `contextLimit` is wired to `max_tokens` — **this is the live bug**

Trace it:

- [`provision.ts:122`](../../../src/lib/models/provision.ts) — `contextLimit: plan.preset.{localCoderQuality,localAgentFast}.defaultContext`
- [`qwen-code.ts:33,41`](../../../src/lib/orchestrator/qwen-code.ts) — `return { ...resolved, maxTokens: modelCfg.contextLimit }`
- [`generic-agent.ts:474`](../../../src/lib/orchestrator/generic-agent.ts) — `max_tokens: provider.maxTokens`

`max_tokens` in the OpenAI protocol is the **maximum number of tokens the model
may generate**. It is not the context window. On this 128 GB Mac the coding agent
is currently told it may emit **32,768 output tokens** in a single completion.

`contextLimit` has no other non-test reader. It constrains nothing.

### 0.4 The memory presets were written for llama.cpp, not MLX

[`LOCAL_MEMORY_PRESETS`](../../../src/lib/models/local-engine.ts) carries quant
strings `UD-Q4_K_M`, `IQ4_XS`, `Q5_K_M`, `Q6_K`, `Q8_0`, `UD-Q8_K_XL`. Those are
GGUF/Unsloth names. The engine we run is MLX, whose catalog
([`local-quant.ts`](../../../src/lib/models/local-quant.ts)) is `4bit` / `6bit` /
`8bit`.

`grep` confirms `preset.localAgentFast.quant` and `preset.localCoderQuality.quant`
are **read by exactly one test, which asserts the string equals itself.**
Provisioning never consults them: absent an explicit operator selection,
[`planLocalEngine`](../../../src/lib/models/provision.ts) takes tiers from
`DEFAULT_TIERS`, which is hardcoded 4-bit for both.

Net effect on this machine: the 128 GB preset's rationale reads *"the first tier
where both models can be kept usable at the same time while preserving high
coding quality… Q8_0 or UD-Q8_K_XL"* — and the code installs
`qwen3.6-27b-4bit`. Meanwhile `Qwen3.6-35B-A3B-8bit` **is already downloaded** to
the HF cache and unused.

### 0.5 Corrections to the pre-spec analysis — flags that are ALREADY optimal

Three levers were proposed before the help text was read carefully. All three are
wrong, and the spec must not "fix" them:

- **Prefix caching is already on.** `--enable-prefix-cache` help: *"(default:
  enabled)"*. There is a populated `~/.cache/rapid-mlx/prefix_cache/` to prove it.
- **KV cache is already aggressively quantized.** `--kv-cache-dtype` help:
  *"(R15 #300, default: int4) … int4 yields ~4× less bandwidth per decode step
  with 97-98% quality retention."* The default is **not** bf16. Moving to int8
  *costs* memory and *buys* quality — the opposite of the usual framing.
- **Speculative decoding is unavailable to us.** `rapid-mlx info` reports
  `Spec decode: ✗ disabled (hybrid arch)` for the 35B and
  `✗ disabled (no MTP/drafter trained)` for the 27B. DFlash and DDTree are
  ineligible on both (MoE, and 4-bit < the ≥8-bit floor). Not a lever. Do not
  spend a phase on it.

### 0.6 PFlash is on for our models but never fires on agent traffic

`--pflash` help: *"Default: 'always' for verified aliases (Qwen3.5 / Qwen3.6
family per #287)"*, threshold 32,768 prompt tokens.

But `--pflash-include-tools` help: *"Allow PFlash compression on prompts with
tool definitions. **By default tool prompts are skipped for tool-call
reliability.**"*

Every HiveMatrix agent prompt carries tool definitions. So the one mechanism that
would have salvaged an oversized prompt is disabled precisely on the traffic that
grows oversized. This is why 0.2's failure mode is silent.

### 0.7 `--no-thinking` does what the code comment claims

Worth recording, since it looked suspect. `--no-thinking` help says it disables
the parser and *"Thinking tokens will appear as regular content"* — which alone
would not save latency. But `--no-reasoning-parser` help clarifies: *"Distinct
from `--no-thinking` (**which also suppresses the chain-of-thought prompt
template**)."* The template suppression is the latency lever. The comment in
[`local-engine.ts`](../../../src/lib/models/local-engine.ts) stands.

---

## 1. Plain-English: what actually governs local quality and speed

Three knobs, in descending order of impact. Everything else is noise.

**1. How many tokens you send (context).** The model re-reads the entire
conversation on every turn. Memory for that grows *linearly* with length, and
time-to-first-token grows with it too. This is the knob the operator is asking
about, and today it is unbounded.

**2. Weight quantization.** How much precision each of the model's parameters
keeps. 4-bit is small and fast; 8-bit is ~1.85× larger and smarter. This is fixed
at 4-bit today regardless of how much RAM the machine has.

**3. KV-cache dtype.** The conversation, once read, is cached in compressed form.
Rapid-MLX defaults to `int4` — very cheap, 97-98% quality retained. For hard
reasoning and math it is the wrong default: Rapid-MLX's own `--reasoning` profile
*pins int8 regardless of the dtype flag*, and its help warns **"sub-4-bit drops
-20pt on AIME-class math for Qwen3 thinking variants."**

### The arithmetic, computed from this machine's model configs

KV bytes/token = `2 (K+V) × layers × kv_heads × head_dim × bytes_per_elem`,
plus affine-quant scale/bias overhead at `group_size=64`.

| Context | 35B fast @int4 | 35B fast @int8 | 27B coding @int4 | 27B coding @int8 |
|---:|---:|---:|---:|---:|
| 8,192 | 0.18 G | 0.33 G | 0.56 G | 1.06 G |
| 32,768 | 0.70 G | 1.33 G | 2.25 G | 4.25 G |
| 65,536 | 1.41 G | 2.66 G | 4.50 G | 8.50 G |
| 131,072 | 2.81 G | 5.31 G | 9.00 G | 17.00 G |
| 262,144 | 5.62 G | 10.62 G | 18.00 G | 34.00 G |

The 27B is **4× more expensive per token** than the 35B — 64 layers × 4 kv_heads
against 40 × 2. The MoE model is the cheap one to give a long context to. This is
the reverse of what the presets assume (they give both tiers the same
`defaultContext`).

### Total resident footprint, 128 GB Mac, both tiers hot

Weights + KV at full context. Metal's allocation limit at the default
`--gpu-memory-utilization 0.90` is ~115 G.

| Weights | KV dtype | ctx 32,768 | ctx 65,536 | ctx 262,144 |
|---|---|---:|---:|---:|
| 4-bit (34.0 G) | int4 | 37.0 G | 39.9 G | 57.6 G |
| 4-bit | int8 | 39.6 G | 45.2 G | 78.6 G |
| **8-bit (62.7 G)** | **int4** | **65.7 G** | **68.6 G** | **86.3 G** |
| 8-bit | int8 | 68.3 G | 73.9 G | 107.3 G ⚠ |
| 8-bit | bf16 | 73.2 G | 83.7 G | 146.7 G ✗ |

**Read this table as the justification for every default in §3.** On 128 GB, 8-bit
weights with int4 KV at 65,536 context lands at 68.6 G — comfortable — and is
strictly better than the 4-bit weights we ship today. We are leaving quality on
the table on the one machine the presets were written for.

---

## 2. The problems, restated as work

| # | Problem | Severity |
|---|---|---|
| P1 | `contextLimit` is sent as `max_tokens` (generation cap) | Bug — wrong behavior today |
| P2 | Nothing enforces a context budget; prompts can reach 262k unchecked | Bug — silent memory pressure |
| P3 | Preset `quant` strings are GGUF, never read; provisioning always picks 4-bit | Dead code + lost quality |
| P4 | `defaultContext`/`maxRecommendedContext` are the same for both tiers, despite 4× cost difference | Wrong model |
| P5 | No way to pass `--kv-cache-dtype` per tier | Missing quality lever |
| P6 | PFlash skips tool prompts, so oversized agent prompts are never compressed | Missing safety net |

---

## 3. Design: separate Load config from Inference config, the way LM Studio does

LM Studio's central structural decision — and the thing HiveMatrix got wrong — is
that **load-time** and **inference-time** settings are two different objects.

Their `LLMLoadModelConfig` (applied when the model is loaded) carries
`contextLength`, `evalBatchSize`, `flashAttention`, `keepModelInMemory`,
`llamaKCacheQuantizationType`, `llamaVCacheQuantizationType`, `gpu`,
`ropeFrequencyBase/Scale`. Their `LLMPredictionConfigInput` (applied per request)
carries `temperature`, `maxTokens`, `topP`, `stop`. `contextLength` never appears
in the prediction config; `maxTokens` never appears in the load config.

HiveMatrix collapsed the two, which is exactly how `contextLimit` ended up in
`max_tokens`. Mirror LM Studio's split.

### 3.1 New types

```ts
// src/lib/models/local-tuning.ts (new)

/** Applied at `rapid-mlx serve` time. One per tier. */
export interface LoadConfig {
  /** Client-enforced prompt budget, in tokens. NOT a serve flag — MLX has none.
   *  Enforced by the context governor (§3.3) before dispatch. */
  contextLimit: number;
  /** --kv-cache-dtype. Rapid-MLX default is int4. */
  kvCacheDtype: "int4" | "int8" | "bf16";
  /** --cache-memory-percent. Rapid-MLX default 0.20. */
  cacheMemoryPercent?: number;
  /** --no-thinking when false. */
  reasoning: boolean;
}

/** Applied per request. */
export interface InferenceConfig {
  /** OpenAI `max_tokens` — GENERATION cap. Never the context window. */
  maxOutputTokens: number;
  temperature: number;
  topP?: number;
}
```

`LocalTier` gains `load: LoadConfig`. `ModelProvider.maxTokens` is **renamed
`maxOutputTokens`** so the category error cannot recur silently.

### 3.2 Defaults, derived from §1's tables — not hand-authored

Replace the GGUF-flavored `LOCAL_MEMORY_PRESETS` role blocks with per-tier values
that respect the 4× cost asymmetry between the tiers.

| RAM tier | fast: quant / ctx / kv | coding: quant / ctx / kv | Footprint |
|---|---|---|---|
| < 32 GB | — (cloud only) | — | — |
| 32 GB | 4bit / 16,384 / int4 | disabled | ~19.4 G |
| 48 GB | 4bit / 32,768 / int4 | disabled | ~19.7 G |
| 64 GB | 4bit / 32,768 / int4 | 4bit / 16,384 / int4 | ~35.8 G |
| **128 GB** | **8bit / 65,536 / int4** | **8bit / 32,768 / int8** | **~71.2 G** |

Two deliberate choices at 128 GB, both justified by the tables above:

- **8-bit weights.** 62.7 G of weights against a ~115 G Metal limit. The 35B-8bit
  is already on disk (§0.4). This is the single largest quality win available and
  it costs nothing but disk.
- **int8 KV on the coding tier only.** The coding tier serves the `coding` and
  `thinking` roles ([`ROLE_TO_TIER`](../../../src/lib/models/local-engine.ts)),
  which is precisely the traffic Rapid-MLX's help warns loses 20 points on
  AIME-class math under sub-4-bit KV. It costs 2.0 G at 32,768 context. The fast
  tier stays int4 — it does triage and voice, where bandwidth is the constraint.

`maxOutputTokens` defaults to **4,096** for every tier — matching
`PROVIDER_DEFAULTS` in [`providers.ts`](../../../src/lib/config/providers.ts),
and *not* to the context limit.

### 3.3 The context governor

New `src/lib/models/context-governor.ts`. Before any local dispatch:

1. Estimate prompt tokens (chars/3.5 is adequate; do not add a tokenizer dep).
2. If `estimate + maxOutputTokens <= contextLimit`, send.
3. Otherwise compact — drop oldest non-system turns until it fits, then log a
   `context_compacted` event with `{tier, before, after, dropped}`.
4. If a *single* turn cannot fit, fail loudly with a typed error rather than
   letting the server swap.

This is the knob the operator was reaching for. It is the only place a context
number can have an effect, because there is no serve flag (§0.1).

### 3.4 Serve args

```ts
export function buildServeArgs(tier: LocalTier): string[] {
  const args = ["serve", tier.alias, "--host", "127.0.0.1", "--port", String(tier.port)];
  if (!tier.load.reasoning) args.push("--no-thinking");
  args.push("--kv-cache-dtype", tier.load.kvCacheDtype);
  if (tier.load.cacheMemoryPercent != null) {
    args.push("--cache-memory-percent", String(tier.load.cacheMemoryPercent));
  }
  return args;
}
```

Note the interaction, from the help text: `--reasoning` **pins int8 regardless of
`--kv-cache-dtype`**. So when `reasoning: true`, `kvCacheDtype` is advisory only.
`buildServeArgs` must not pass both `--reasoning` and a contradicting dtype
without a comment saying which wins. Assert this in a test.

### 3.5 Settings UI

Extend the existing Rapid-MLX block in Settings → Models (from
`2026-07-09-local-engine-toggle-model-picker-spec.md`), which already renders a
per-tier quant picker. Add, per tier:

- **Context limit** — slider, snapped to powers of two from 8,192 to 262,144.
  Live label showing the KV cost at the selected `kvCacheDtype`, computed from
  §1's formula. This is LM Studio's pattern: the number and its memory
  consequence in the same control.
- **KV cache** — segmented `int4 / int8 / bf16`, with the quality note inline.
- A **total footprint** readout under the block: `weights + Σ kv` against
  `0.90 × totalmem`, turning amber past 85% and red past 95%.

Nothing here is a solver. Same posture as the quant picker: show the options, show
the cost, let the operator choose.

---

## 4. Phases

Each phase is independently shippable and independently revertable.

### Phase 1 — Fix the category error (P1). No behavior change beyond correctness.
- Rename `ModelProvider.maxTokens` → `maxOutputTokens`.
- `buildQwenProvider` stops assigning `contextLimit` to it; assigns `4096`.
- Test: a built provider's `maxOutputTokens` is never equal to `contextLimit`
  unless `contextLimit === 4096` by coincidence — assert on the literal.

### Phase 2 — `LoadConfig` / `InferenceConfig` types + serve-arg pass-through (P5).
- Add `local-tuning.ts`. `LocalTier.load`. Extend `buildServeArgs`.
- Test the `--reasoning` / `--kv-cache-dtype` precedence documented in §3.4.
- Still ships the current 4-bit/int4 defaults — no footprint change yet.

### Phase 3 — Context governor (P2).
- `context-governor.ts` + wire into the local dispatch path.
- Test: an over-budget conversation compacts; a single over-budget turn throws.
- This is the phase that makes `contextLimit` mean something for the first time.

### Phase 4 — Re-derive the presets (P3, P4).
- Delete the GGUF `quant` strings and the single tautological test that reads them.
- Replace `defaultContext`/`maxRecommendedContext` with the per-tier §3.2 table,
  and add a comment recording the provenance — *computed from `config.json`,
  2026-07-09* — the way `downloadGiB` in `local-quant.ts` records its own.
- Make `planLocalEngine` honor the preset's quant instead of always `DEFAULT_TIERS`.
- **On this machine this flips the default from 4-bit to 8-bit.** Gate behind the
  existing operator selection: an explicit prior selection always wins.

### Phase 5 — Settings UI (§3.5).

### Phase 6 — PFlash safety net (P6). *Optional, measure first.*
- `--pflash-include-tools` exists precisely for this. Rapid-MLX disables it by
  default "for tool-call reliability," which is a real risk for our agent traffic.
- Do **not** enable it blind. Run the existing `tools/model-bench` two-step
  tool-calling task with the flag on and off at a >32k prompt. Ship only if the
  tool-call pass rate is unchanged.

---

## 5. Non-goals — do not touch these

Recorded so a future agent does not "optimize" a correct default. See §0.5.

- `--enable-prefix-cache` — already on.
- `--spec-decode`, `--enable-dflash`, `--enable-ddtree`, `--enable-mtp` —
  architecturally unavailable to both of our models. Verified via `rapid-mlx info`.
- `--kv-cache-turboquant` — experimental, and the alias profile already sets
  `turboquant_tier=k8v4_verified`. Leave it to the engine.
- `--continuous-batching` — already on.
- `--gpu-memory-utilization` — 0.90 is right until we exceed ~115 G resident,
  which §3.2's defaults do not.
- Sampling params beyond `temperature`/`maxOutputTokens`. `deep-think.ts` already
  owns temperature diversity and should keep owning it.

---

## 6. Verification

The claim "context size is now optimum" is only earnable by measurement. Two
gates:

1. **Correctness gate (Phases 1–4).** `tools/model-bench` at the current 12/12
   correctness and 2/2 tool-calling bar. 8-bit weights must not regress
   tool-calling; if they do, the Phase 4 flip is reverted, not papered over.

2. **A sweep, not a guess.** Extend `tools/model-bench` to hold the task set fixed
   while varying `(weight_quant, kv_cache_dtype, context_limit)`, recording peak
   RSS, TTFT, decode tok/s, and correctness. That table — not this spec — is what
   makes the defaults in §3.2 defensible. Until it exists, §3.2 is an *arithmetic*
   argument, which is better than the status quo (an unexamined constant that
   reaches nothing) but is not yet an *empirical* one.

Record the sweep output in this file under a `## 7. Measured results` heading and
update §3.2 from it.
