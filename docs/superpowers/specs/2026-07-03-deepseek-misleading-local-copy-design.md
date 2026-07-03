# DeepSeek Misleading Local Copy Design

## Context

HiveMatrix can now configure Dwarf Star DeepSeek as the local model, but several UI strings still assume Qwen or Rapid-MLX:

- Right-panel usage and observability copy says local Qwen.
- Settings role defaults say local Qwen.
- Settings Models appends the Rapid-MLX engine card even when Dwarf Star is the configured backend.
- The connectivity posture must avoid claiming Local Qwen when the configured model is DeepSeek.

## Goal

Make operator-facing local-model copy generic or DeepSeek-aware so a Dwarf Star DeepSeek setup is not presented as Qwen/Rapid-MLX.

## Non-Goals

- Do not remove Qwen/Rapid-MLX support.
- Do not rename the Rapid-MLX embeddings preset; it is specifically a Qwen embedding model.
- Do not change model routing or provider resolution.

## Approach

- Reuse the existing Dwarf Star detector in the console.
- In Settings Models, render the Dwarf Star DeepSeek backend card instead of the Rapid-MLX engine card when selected.
- Replace generic usage/observability copy with "local model" language.
- Keep provider-specific labels only when reporting actual provider telemetry.
- Keep connectivity posture generic: "Local model" and "configured local model."

## Verification

- Focused console tests for DeepSeek-aware Settings Models rendering and no visible local-Qwen copy.
- Connectivity posture test requiring generic local model language.
- Full gates: typecheck, npm test, scope-wall.
