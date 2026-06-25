# Config API Lane Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Task 1: Lock Config/API Visible Copy

- [x] Add `scripts/config-api-lane-copy.test.mjs`.
- [x] Assert `src/lib/config/features.ts` uses `Voice Lane`.
- [x] Assert `src/lib/config/secrets.ts` uses `Market Data Lane`.
- [x] Assert `src/lib/config/agent-profiles.ts` says `new skill, MCP, lane, or shared capability contract`.
- [x] Assert `src/daemon/server.ts` says `Market Data Lane not configured`.
- [x] Assert `src/lib/orchestrator/bee-tools.ts` says `unknown lane tool`.
- [x] Run `npm test -- scripts/config-api-lane-copy.test.mjs` and confirm it fails before production changes.

## Task 2: Update Visible Copy

- [x] Update `src/lib/config/features.ts`.
- [x] Update `src/lib/config/secrets.ts`.
- [x] Update `src/lib/config/agent-profiles.ts`.
- [x] Update `src/daemon/server.ts`.
- [x] Update `src/lib/orchestrator/bee-tools.ts` and tests expecting the old unknown-tool copy.
- [x] Preserve internal names, route paths, and compatibility ids.
- [x] Run `npm test -- scripts/config-api-lane-copy.test.mjs src/lib/orchestrator/bee-tools.test.ts src/lib/config/secrets.test.ts` and confirm it passes.

## Task 3: Verify And Ship

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Commit and push to `main`.
