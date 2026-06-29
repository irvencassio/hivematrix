# Mail Lane Disabled Passive Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Add failing passive-status route tests in `src/daemon/server.test.ts`.
  - Prove `GET /mailbee` returns `mailProbeSkipped: true` and does not call the injected probe when the Mail Lane channel is disabled.
  - Prove `GET /onboarding` does not call the injected probe when disabled.
  - Prove `POST /mailbee/probe` calls the injected probe.

- [x] Add failing prompt-generation tests in `src/lib/orchestrator/outbound-routing.test.ts` and `src/lib/orchestrator/codex-agent.test.ts`.
  - Disabled Mail Lane prompt must omit `/mailbee/send`, `/mailbee/draft`, and direct Apple Mail management guidance.
  - Enabled Mail Lane prompt must preserve existing Mail Lane instructions.

- [x] Implement `src/lib/mailbee/status.ts`.
  - `getMailbeeStatus({ probe: false })` reads store state and skips Apple Mail probing while disabled.
  - `getMailbeeStatus({ probe: true })` calls `canControlMail()`.
  - Add a test-only dependency setter so route tests can fail if passive code probes.

- [x] Update `src/daemon/server.ts`.
  - Use passive `getMailbeeStatus()` in `GET /mailbee`.
  - Use passive `getMailbeeStatus()` in `GET /onboarding`.
  - Add `POST /mailbee/probe`.

- [x] Update `src/lib/orchestrator/outbound-routing.ts`, `src/lib/orchestrator/codex-agent.ts`, and `src/lib/orchestrator/subprocess.ts`.
  - Parameterize `outboundHttpRoutingPrompt()` with Mail Lane availability.
  - Read Mail Lane enabled state at prompt construction call sites.
  - Keep Message Lane instructions available regardless of Mail Lane.

- [x] Verify.
  - `npm test -- src/daemon/server.test.ts src/lib/orchestrator/outbound-routing.test.ts src/lib/orchestrator/codex-agent.test.ts`
  - `npm run typecheck`
  - `node scripts/scope-wall.mjs`
