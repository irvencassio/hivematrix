# HiveMatrix Qwen Local Profile — M5 Max 128GB

Date: 2026-06-11
Status: Phase 2 target spec (Q2 decision)

## Hardware baseline

MacBook Pro M5 Max, 128GB unified memory, no LAN GPU box.
Primary serving: MLX-first (mlx-lm or Rapid-MLX). Fallback: llama.cpp/GGUF. vLLM deferred.

## Model targets

### Primary — `code-critical` (local), `execute` (heavy)

**Qwen3-Coder-Next (80B-A3B), 4-bit MLX quant**
- ~42GB on disk, ~48GB+ RAM in use — fits 128GB with room for 100K+ context
- ~70% SWE-bench class per community benchmarks; agentic-coding specialist
- 262K native context
- Tool calling must be proven by readiness gate on the MLX path before the router will use it

### Secondary — `execute` (fast/bulk), `cheap-web`, summarization

**Qwen3.6-35B-A3B (or current 3.5/3.6 medium MoE), Q8**
- ~70–80 tok/s class on Apple Silicon — fast lane for extraction, drafting, WebBee summarization
- 128GB affords Q8 where quality over Q4 matters

## Serving stack

- **Primary: MLX** — mlx-lm server or Rapid-MLX (OpenAI drop-in with tool-parser + `<think>`-separation, which aligns with Phase 2 generic-loop fixes).
- **Fallback: llama.cpp / GGUF** (unsloth quants) — most battle-tested tool-calling path for Qwen3-Coder.
- **Deferred: vLLM** — only if a LAN Linux/GPU box appears.
- **Required fix (Phase 2):** `mlx` provider must NOT be hardcoded `supportsTools: false` — capability is probed by the readiness gate. See `src/lib/local-model/health.ts` TODO comment.

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
| `think` | Frontier favorite (Claude); local-only: Qwen3-Coder-Next |
| `code-critical` | Frontier harness while headroom; else Qwen3-Coder-Next via Qwen Code, frontier review queued |
| `execute` | Qwen3.6-35B-A3B; escalate to Coder-Next on failure or by task tag |
| `cheap-web` | Qwen3.6-35B-A3B |
| `image` | Nano Banana (cloud-ok); local mflux fallback in local-only/offline |
