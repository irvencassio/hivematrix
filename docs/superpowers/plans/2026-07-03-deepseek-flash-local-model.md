# DeepSeek Flash Local Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Add failing tests in `src/lib/models/local-engine.test.ts` proving DeepSeek Flash is not a Rapid-MLX tier and Qwen remains fast/coding only.
- [x] Add failing tests in `src/lib/models/available.test.ts` proving Settings exposes configured local tiers and the Dwarf Star DeepSeek preset in available models and local role dropdowns.
- [x] Add `src/lib/models/local-presets.ts` with the Dwarf Star DeepSeek preset, endpoint `http://127.0.0.1:8000/v1`, model id `deepseek-v4-flash`, and exact GGUF filename.
- [x] Keep `src/lib/models/local-engine.ts` scoped to Qwen + Rapid-MLX fast/coding tiers.
- [x] Update `src/lib/models/provision.ts` so hardware provisioning continues to pull only recommended resident Qwen tiers.
- [x] Update `src/lib/models/available.ts` so Settings/New Task include all configured local engine tiers and Dwarf Star DeepSeek without duplicate model entries.
- [x] Update provider, health, generic-agent, system-readiness, and observability paths so Dwarf Star is local/OpenAI-compatible and reports separately from Qwen.
- [x] Run targeted tests, typecheck, scope-wall, and local readiness gate.
