# DeepSeek Flash Local Model Design

> ⚠️ **SUPERSEDED 2026-07-06 — DeepSeek/ds4 removed; the local stack is Qwen-only.**
> Retained as a historical record. See
> docs/superpowers/plans/2026-07-06-qwen-only-local-presets.md


## Context

HiveMatrix already supports local OpenAI-compatible model backends through the
Rapid-MLX local engine and legacy LM Studio/Ollama settings. The Settings screen
builds its model dropdowns from configured backends and Rapid-MLX tiers.

After reviewing the local Dwarf Star project and upstream `antirez/ds4`, the
DeepSeek path should not be modeled as another Rapid-MLX tier. There are two
separate local approaches:

- Qwen + Rapid-MLX: HiveMatrix-managed fast/coding tiers.
- DeepSeek + Dwarf Star: optimized `ds4-server` runtime with DeepSeek-specific
  prompt rendering, tool handling, disk KV cache, and coding-agent support.

The requested model is:

`DeepSeek-V4-Flash-IQ2XXS-w2Q2K-AProjQ8-SExpQ8-OutQ8-chat-v2-imatrix.gguf`

It should be visible and selectable in Settings without replacing the current
Qwen defaults or forcing every install to pull or serve it.

## Approach

Add DeepSeek Flash as a first-class optional local model preset backed by Dwarf
Star:

- Keep Qwen fast/coding as the default provisioned tiers.
- Do not add DeepSeek to the Rapid-MLX process manager or provisioner.
- Add a Dwarf Star provider preset on port `8000` using API model id
  `deepseek-v4-flash` and documenting the exact GGUF filename.
- Expose configured Rapid-MLX tier aliases plus the Dwarf Star DeepSeek preset
  in Settings model and role dropdowns.
- Report Dwarf Star DeepSeek health and observability separately from Qwen.
- Preserve the existing local primary model entry and avoid duplicates.

## Alternatives Considered

1. Replace the fast Qwen tier with DeepSeek Flash.
   Rejected because it would silently change routing behavior for existing users.

2. Add only UI text while keeping routing unchanged.
   Rejected because selecting the model would not reliably route to a provider.

3. Add DeepSeek as an optional Rapid-MLX tier preset.
   Rejected after reviewing Dwarf Star: the optimized DeepSeek path is
   `ds4-server`, not Rapid-MLX.

4. Add DeepSeek as a Dwarf Star local provider preset.
   Chosen because it gives Settings visibility, provider routing, health status,
   and observability while keeping provisioning conservative and preserving the
   optimized Dwarf Star agent/server behavior.

## Verification

- Unit tests proving DeepSeek is not a Rapid-MLX tier.
- Unit tests for Settings model/role option exposure.
- Unit tests for Dwarf Star provider resolution and observability grouping.
- Typecheck and targeted model tests.
