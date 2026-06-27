# Voice Logic Settings Diagnostic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Add `src/lib/voice/logic-scenarios.ts` with canned no-audio scenarios and stubbed dependencies.
- [x] Add `src/lib/voice/logic-scenarios.test.ts` proving the runner passes, never returns audio, and records simulated side effects only.
- [x] Add `POST /settings/voice/test-scenarios` in `src/daemon/server.ts`.
- [x] Add Settings → Features UI controls in `src/daemon/console.ts`.
- [x] Extend `src/daemon/console.test.ts` to assert the Settings UI exposes the runner and endpoint.
- [x] Run focused tests:
  - `node --import tsx/esm --test src/lib/voice/logic-scenarios.test.ts src/daemon/console.test.ts`
  - `npm run typecheck`
