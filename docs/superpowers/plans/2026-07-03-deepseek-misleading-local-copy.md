# DeepSeek Misleading Local Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Design Reference

- `docs/superpowers/specs/2026-07-03-deepseek-misleading-local-copy-design.md`

## Task 1 — RED: Misleading Copy Tests

- [x] Add console tests proving Settings Models uses the DeepSeek-aware local card.
- [x] Add console tests proving visible console copy does not hardcode local Qwen for generic local-model messaging.
- [x] Preserve the existing posture test that requires "Local model" instead of "Local Qwen".

Run:

```bash
node --import tsx/esm --test src/daemon/console.test.ts src/lib/connectivity/posture.test.ts
```

Expected RED before implementation.

## Task 2 — GREEN: Generic/DeepSeek-Aware Labels

- [x] Update Settings Models local status rendering to skip `renderLocalEngine(...)` for Dwarf Star.
- [x] Replace generic usage and observability strings from "local Qwen" to "local model".
- [x] Replace generic observability label fallback from `Qwen (local)` to `Local model`.
- [x] Replace role default copy with "Default — local model".

Run focused tests again. Expected GREEN.

## Task 3 — Verification And Release Prep

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [ ] Commit fixes on `main`.
- [ ] Push `main`.
- [ ] Run `npm run autodeploy`.
