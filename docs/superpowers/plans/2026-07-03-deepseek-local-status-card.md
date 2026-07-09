# DeepSeek Local Status Card Implementation Plan

> ⚠️ **SUPERSEDED 2026-07-06 — DeepSeek/ds4 removed; the local stack is Qwen-only.**
> Retained as a historical record. See
> docs/superpowers/plans/2026-07-06-qwen-only-local-presets.md


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Design Reference

- `docs/superpowers/specs/2026-07-03-deepseek-local-status-card-design.md`

## Task 1 — RED: Console Models Panel Tests

- [x] Edit `src/daemon/console.test.ts`.
- [x] Add a test asserting `checkModels()` reads the configured local backend from `models.backends`.
- [x] Assert Dwarf Star/DeepSeek detection exists.
- [x] Assert Dwarf Star/DeepSeek renders through a dedicated card helper.
- [x] Assert Rapid-MLX tier rendering is skipped when Dwarf Star/DeepSeek is the local backend.

Run:

```bash
node --import tsx/esm --test src/daemon/console.test.ts
```

Expected RED.

## Task 2 — GREEN: Render DeepSeek Local Backend Card

- [x] Edit `src/daemon/console.ts`.
- [x] Add `isDwarfStarLocalBackend(backend, health)`.
- [x] Add `renderLocalBackendChoice(backend, health)`.
- [x] Use Dwarf Star/DeepSeek labels when provider/name/detail/model indicates that path.
- [x] Change `checkModels()` to render Dwarf Star/DeepSeek card instead of `renderLocalEngine(...)` when selected.
- [x] Preserve Rapid-MLX rendering for Qwen local engine setups.

Run:

```bash
node --import tsx/esm --test src/daemon/console.test.ts
```

Expected GREEN.

## Task 3 — Verification

- [x] Run:

```bash
npm run typecheck
npm test
node scripts/scope-wall.mjs
```
