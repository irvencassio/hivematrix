# Model-Facing Lane Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Task 1: Pin Local Agent Tool Description Language

- [x] Add failing assertions in `src/lib/orchestrator/bee-tools.test.ts`:
  - Descriptions contain `Mail Lane`, `Message Lane`, `Terminal Lane`, and `Desktop Lane`.
  - Descriptions do not contain capitalized `MailBee`, `MessageBee`, `TermBee`, or `DesktopBee`.
  - User-facing refusal/success strings use lane names.
- [x] Update `src/lib/orchestrator/bee-tools.ts` descriptions and result strings.
- [x] Run `npm test -- src/lib/orchestrator/bee-tools.test.ts`.

## Task 2: Pin CLI/MCP Prompt Language

- [x] Add failing assertions in `src/lib/orchestrator/outbound-mcp.test.ts` that MCP descriptions say `Mail Lane` and `Message Lane`, not `MailBee` or `MessageBee`.
- [x] Add failing assertions in `src/lib/orchestrator/outbound-routing.test.ts` that routing prompts use Lane prose while preserving compatibility routes.
- [x] Update `src/lib/orchestrator/outbound-mcp.ts` and `src/lib/orchestrator/outbound-routing.ts`.
- [x] Run targeted orchestrator tests.

## Task 3: Pin Posture Labels

- [x] Add failing assertions in `src/lib/connectivity/posture.test.ts` for `Desktop Lane` and `Terminal Lane` labels.
- [x] Update `src/lib/connectivity/posture.ts` labels and notes.
- [x] Run `npm test -- src/lib/connectivity/posture.test.ts`.

## Task 4: Verify And Ship

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Commit and push to `main`.
