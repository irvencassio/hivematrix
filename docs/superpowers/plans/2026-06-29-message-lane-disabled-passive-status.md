# Message Lane Disabled Passive Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Add failing route tests in `src/daemon/server.test.ts`.
  - Passive `GET /messagebee` must skip chat.db probing while disabled.
  - Passive `GET /onboarding` must skip chat.db probing while disabled.
  - Explicit `POST /messagebee/probe` must call the probe.
  - Disabled `POST /messagebee/send` must refuse without sending.

- [x] Add failing prompt and MCP tests.
  - `outboundHttpRoutingPrompt(..., { messageLaneEnabled: false })` must omit `/messagebee/send`.
  - `buildCodexPrompt(..., { messageLaneEnabled: false })` must omit iMessage guidance.
  - `outboundMcpToolNames({ messageLaneEnabled: false })` must omit `send_imessage`.

- [x] Implement `src/lib/messagebee/status.ts`.
  - Return enabled state, identities, readable state, detail, and skipped-probe metadata.
  - Add a test-only dependency setter for `probeChatDbAccess`.

- [x] Update daemon and service-manager status paths.
  - Use passive `getMessagebeeStatus()`.
  - Add explicit `POST /messagebee/probe`.

- [x] Gate outbound sending and agent surfaces.
  - Refuse Message Lane sends when disabled.
  - Gate prompt generation and MCP tool exposure by `messageLaneEnabled`.

- [x] Verify.
  - Focused tests for daemon, routing, MCP, Codex prompt, lane tools, onboarding, and service manager.
  - `npm run typecheck`
  - `npm test`
  - `node scripts/scope-wall.mjs`
