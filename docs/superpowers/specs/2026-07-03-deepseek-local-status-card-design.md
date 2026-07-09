# DeepSeek Local Status Card Design

> ⚠️ **SUPERSEDED 2026-07-06 — DeepSeek/ds4 removed; the local stack is Qwen-only.**
> Retained as a historical record. See
> docs/superpowers/plans/2026-07-06-qwen-only-local-presets.md


## Context

The Settings and right-panel Models surfaces already support local backends in the model catalog:

- Rapid-MLX/Qwen tiers via `src/lib/models/local-engine.ts`.
- Dwarf Star/DeepSeek Flash via `src/lib/models/local-presets.ts`, provider `dwarfstar`, model id `deepseek-v4-flash`.
- Backend detection in `src/lib/models/backends.ts` labels configured Dwarf Star as `Local server (Dwarf Star)`.

The visible right-panel card still assumes the local engine is Rapid-MLX:

- `checkModels()` renders `renderLocalEngine(models.localEngine, ...)`.
- `localEngineStatus()` defaults to Rapid-MLX tier probes even when the configured `localModel.provider` is `dwarfstar`.
- The result is the screenshot: a Qwen/Rapid-MLX fast + coding card appears even when the operator wants DeepSeek.

## Goal

When the configured local choice is DeepSeek/Dwarf Star, the `Local · on-device` card should show Dwarf Star DeepSeek status instead of Rapid-MLX Qwen tier status.

## Non-Goals

- Do not add DeepSeek to the Rapid-MLX tier manager.
- Do not change provider resolution, local health probing, or provisioning.
- Do not change the setup wizard provisioning path.

## Approach

Use the existing `/models` payload:

- Read `models.backends.find(b => b.id === "local")`.
- If that local backend name/detail indicates Dwarf Star or DeepSeek, render a Dwarf Star local backend card.
- Prefer cached `models.localModelHealth` when available for ready/not-ready details.
- Otherwise show the backend detail and endpoint from `models.backends`.
- Only render the Rapid-MLX tier card when the configured local backend is not Dwarf Star/DeepSeek.

## Test Strategy

Add focused static/browser-script assertions in `src/daemon/console.test.ts`:

- `checkModels()` derives `localBackend` from `models.backends`.
- It detects a Dwarf Star local backend.
- It renders `renderLocalBackendChoice(...)`.
- It skips `renderLocalEngine(...)` when Dwarf Star/DeepSeek is selected.
- The Dwarf Star card contains DeepSeek-specific labels and health details.

Run:

```bash
node --import tsx/esm --test src/daemon/console.test.ts
npm run typecheck
npm test
node scripts/scope-wall.mjs
```
