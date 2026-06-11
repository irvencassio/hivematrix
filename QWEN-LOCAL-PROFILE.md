# HiveMatrix Qwen Local Profile — M5 Max 128GB

Date: 2026-06-11
Status: Phase 2 — provisioned and running (Q2 decision)
Revised: 2026-06-11 — model + serving stack updated after install (see "Revision" note)

## Revision note (2026-06-11)

The original target (Qwen3-Coder-Next 80B-A3B served via mlx-lm/Rapid-MLX) was
superseded during provisioning by two findings:

1. **Model**: Irv selected **Qwen 3.6 27B** — a *dense* model released
   2026-04-21, "flagship-level coding in 27B," 256K context, native vision +
   agentic-coding + thinking-mode. Qwen states it surpasses the prior
   Qwen3.5-397B-A17B flagship on major coding benchmarks. A 27B dense model at
   8-bit is a better quality/latency fit on this hardware than an 80B MoE at
   4-bit, and it removes the MoE serving complexity.
2. **Serving**: **LM Studio** is already installed and serves an
   OpenAI-compatible API (`http://localhost:1234/v1`) with working tool calling
   (verified) and native reasoning separation via the `reasoning_content` field.
   It manages both MLX and GGUF engines. mlx-lm / Rapid-MLX were therefore NOT
   adopted — LM Studio satisfies the tool-calling gate, which was the bar for
   choosing it over standing up our own server.

## Hardware baseline

MacBook Pro M5 Max, 128GB unified memory, no LAN GPU box.
Serving: **LM Studio** (MLX engine primary, GGUF available). vLLM deferred.

## Model targets

### Primary — `think` (local-only), `code-critical` (local), `execute`

**Qwen 3.6 27B (dense), MLX 8-bit** (`lmstudio-community/Qwen3.6-27B-MLX-8bit`)
- ~28GB on disk; comfortable on 128GB with 65K+ context loaded
- Dense (all params active) — no MoE routing variance; flagship-level coding
- 256K native context (loaded at 65K; raise per task need)
- 8-bit chosen over 4-bit for quality headroom ("128GB affords Q8" — and Irv's
  explicit "we need quality too" steer). The 4-bit MLX and Q8 GGUF variants were
  removed after the 8-bit was validated (unused-model cleanup); they are one
  `lms get` away if a fallback is ever needed.
- Tool calling + reasoning separation proven by the readiness gate before router use

### Secondary — (optional fast lane)

Not provisioned. The 27B dense model is fast enough on M5 Max to serve as the
single local model for v1; a smaller fast-lane model can be added later if
extraction/summarization throughput demands it. `qwen.secondary` is `null` in
the live profile.

## Serving stack

- **Primary: LM Studio** (`lms server`, port 1234) — OpenAI-compatible
  `/v1/chat/completions`, tool calling parsed into `tool_calls`, reasoning in
  `reasoning_content`. MLX engine on Apple Silicon.
- **Fallback: LM Studio GGUF engine** — `lmstudio-community/Qwen3.6-27B-GGUF`
  (Q8_0) is the fallback if the MLX path ever regresses; re-pull with
  `lms get lmstudio-community/Qwen3.6-27B-GGUF` (removed from disk after MLX-8bit
  was validated, to reclaim space).
- **Deferred: vLLM** — only if a LAN Linux/GPU box appears.
- **Provider config**: `provider: "lmstudio"`, `supportsTools` is probe-driven
  by the readiness gate, not hardcoded. See `src/lib/local-model/health.ts`.

## Readiness gate (Phase 2 extension of `health.ts`)

A Qwen profile is router-selectable only when all pass on the live endpoint:

1. Model listing + streaming round-trip
2. Single tool call (parser-owned formatting, no ReAct scaffold injected by HiveMatrix)
3. Multi-step tool chain (2+ sequential calls in one task)
4. `<think>`/reasoning-block separation: content clean, no leakage into tool args
5. Long-context smoke: 32K-token prompt answers coherently
6. Sustained decode rate ≥ 15 tok/s (configurable floor)

## Router mapping (default on this hardware)

| Role | Model |
|------|-------|
| `think` | Frontier favorite (Claude); local-only: Qwen 3.6 27B |
| `code-critical` | Frontier harness while headroom; else Qwen 3.6 27B via Qwen Code, frontier review queued |
| `execute` | Qwen 3.6 27B |
| `cheap-web` | Qwen 3.6 27B |
| `image` | Nano Banana (cloud-ok); local mflux fallback in local-only/offline |

## Live profile (`~/.hivematrix/config.json`)

```json
{
  "localModel": { "provider": "lmstudio", "endpoint": "http://localhost:1234/v1", "modelName": "qwen/qwen3.6-27b" },
  "qwen": {
    "location": "local",
    "primary": { "modelId": "qwen/qwen3.6-27b", "endpoint": "http://localhost:1234/v1", "provider": "lmstudio", "contextLimit": 65536 },
    "secondary": null,
    "thinkingEnabled": true, "minDecodeRate": 15, "probeTimeoutMs": 120000
  }
}
```

Note: `qwen/qwen3.6-27b` is LM Studio's API identifier; load the **MLX-8bit**
variant in LM Studio so that identifier resolves to the 8-bit weights.
