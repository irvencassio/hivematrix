# Model-Facing Lane Language Design

## Context

The desktop Settings surface now uses lane names, but HiveMatrix still embeds Bee-era product names in model-facing descriptions and routing prompts. Those strings are read by local Qwen agents, Claude/Codex CLI harnesses, the outbound MCP bridge, and posture clients. If they keep saying `MailBee`, `MessageBee`, `TermBee`, or `DesktopBee`, models can continue using the old words in task routing and voice responses.

## Goal

Keep compatibility identifiers stable while changing model/operator prose to lane language:

- `MailBee` prose -> `Mail Lane`
- `MessageBee` prose -> `Message Lane`
- `TermBee` prose -> `Terminal Lane`
- `DesktopBee` prose -> `Desktop Lane`
- `BrowserBee` / `WebBee` prose -> `Browser Lane`

## Non-Goals

- Rename function names such as `mailbee_send`, `messagebee_send`, `termbee_run`, or `desktopbee_action`.
- Rename route contracts such as `/mailbee/send`, `/messagebee/send`, or `/bee/termbee_run`.
- Rename internal TypeScript types or module folders.
- Rewrite historical specs and changelog entries.

## Approach

1. Add tests that pin the distinction:
   - Tool names and daemon routes may remain lower-case compatibility names.
   - Human/model-facing descriptions and result messages must not contain capitalized Bee brands.
2. Update the local-agent function tool descriptions in `src/lib/orchestrator/bee-tools.ts`.
3. Update outbound MCP tool descriptions in `src/lib/orchestrator/outbound-mcp.ts`.
4. Update CLI routing prompts in `src/lib/orchestrator/outbound-routing.ts`.
5. Update posture labels in `src/lib/connectivity/posture.ts`.
6. Leave historical docs, changelog, and internal comments alone unless they are active prompts or visible labels.

## Acceptance

- Agents see Lane labels in descriptions and prompts.
- Existing API/tool contracts still work.
- Typecheck, full tests, and scope wall pass.
