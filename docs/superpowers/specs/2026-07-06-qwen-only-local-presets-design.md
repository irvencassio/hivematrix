# Qwen-Only Local Presets Design

## Problem

HiveMatrix currently exposes DeepSeek/Dwarf Star as a local model path in several active surfaces: local presets, backend labels, observability buckets, readiness copy, install scripts, and an optional native ds4 agent harness. The Flash Lane reads the configured local profile, so if the profile points at Dwarf Star, chat runs through DeepSeek.

The new goal is to remove the DeepSeek/Dwarf Star path and make Qwen the local model family. HiveMatrix should choose explicit, inspectable Qwen presets from detected unified memory:

- below 32GB: frontier only
- 32GB: Qwen3.6-35B-A3B fast local agent plus small embeddings
- 48GB: stronger Qwen3.6-35B-A3B fast local agent plus small embeddings
- 64GB: Qwen3.6-35B-A3B fast plus Qwen3.6-27B compact coding
- 128GB: Qwen3.6-35B-A3B fast plus Qwen3.6-27B quality coding

## Design

Add first-class local model preset specs beside the existing Rapid-MLX tier model. The specs are data-only and include mode, memory tier, local enabled flag, role assignments, quantization notes, and context limits.

Provisioning will:

- select the highest matching preset for detected memory;
- write `localModelPreset` with the selected preset id and resolved roles;
- write `localEngine` tiers matching the preset;
- write `qwen.primary` to the fast agent tier so Flash chat uses Qwen;
- write `qwen.secondary` to the coding tier when enabled.

Removal scope:

- Remove Dwarf Star / DeepSeek from active providers, model presets, backend labels, observability buckets, install scripts, and the native ds4 harness.
- Keep historical changelog and Superpowers archive entries as historical records unless they are active code/config surfaces.

## Verification

- Focused tests for local presets, provisioning, model availability, provider resolution, observability, readiness labels, and Flash Qwen routing.
- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`
- `npx tsx scripts/qwen-readiness.mts`
