# OpenClaw Chat Dock Design

Date: 2026-06-30
Status: Proposed
Owner: Irv

## Summary

Expose OpenClaw's chat experience inside the HiveMatrix desktop console as an optional bottom dock in the main section. The feature is off by default. If OpenClaw is not installed or not reachable, the setting remains off and is disabled/greyed out with an honest status reason.

This should be a native HiveMatrix panel backed by a daemon-side OpenClaw bridge, not an iframe of OpenClaw Control UI. OpenClaw WebChat is not documented as an embeddable static widget; it is a client surface over the OpenClaw Gateway WebSocket using `chat.history`, `chat.send`, and `chat.inject`. HiveMatrix should therefore own the console UI and proxy only the narrow OpenClaw chat operations it needs.

## Goals

- Add an optional "OpenClaw Chat" dock at the bottom of the HiveMatrix console main section.
- Keep the feature disabled by default on all systems.
- Detect whether OpenClaw is installed and whether the gateway/chat surface is usable.
- Grey out the toggle when OpenClaw is missing or unavailable.
- Keep OpenClaw secrets/tokens server-side; never inject them into console JavaScript.
- Preserve HiveMatrix as the durable task/orchestration system.
- Let an OpenClaw chat turn create a HiveMatrix task through an explicit UI action.
- Keep the implementation local-first and safe on machines that do not have OpenClaw.

## Non-Goals

- Do not embed the full OpenClaw Control UI in an iframe.
- Do not make OpenClaw a default HiveMatrix executor.
- Do not mirror all HiveMatrix tasks into OpenClaw tasks.
- Do not require OpenClaw for HiveMatrix startup, health, or release gates.
- Do not add the native iPhone OpenClaw chat surface in this slice.
- Do not expose OpenClaw gateway credentials to browser code or HiveMatrix-iOS.

## Current State

HiveMatrix:

- Desktop daemon listens on `:3747`.
- Console is served by the daemon.
- All non-public daemon routes require HiveMatrix bearer auth.
- `POST /tasks` is already the durable task ingress for console, iOS, voice, lanes, and loopback task creation.
- Feature flags already exist through `/settings/features` and are consumed by both desktop console and HiveMatrix-iOS.

OpenClaw:

- The local machine currently has `openclaw` installed at `/opt/homebrew/bin/openclaw`.
- OpenClaw docs describe WebChat as a Gateway WebSocket client that uses `chat.history`, `chat.send`, and `chat.inject`.
- OpenClaw docs do not present WebChat as a standalone embeddable HTML widget.
- OpenClaw has its own sessions, tasks, Task Flow, plugins, webhooks, and operator RPC surfaces. Those should not become HiveMatrix's primary task system.

## Design Decision

Use a daemon-side HiveMatrix OpenClaw bridge plus a native console dock.

Rejected alternatives:

1. Iframe OpenClaw Control UI
   - Fast to prototype, but poor auth isolation.
   - Hard to size cleanly inside the HiveMatrix console.
   - Blurs which system owns the operator session.
   - Risks token leakage or awkward cross-origin handling.

2. Direct browser WebSocket to OpenClaw Gateway
   - Avoids some daemon work but exposes OpenClaw auth concerns to browser code.
   - Creates two auth systems in one page.
   - Makes remote HiveMatrix console behavior harder to reason about.

3. Daemon bridge with native HiveMatrix UI
   - Recommended.
   - Keeps OpenClaw credentials server-side.
   - Lets HiveMatrix present OpenClaw status honestly.
   - Lets the UI provide a first-class "Create HiveMatrix task" handoff.

## Feature Flag

Add a feature flag:

```ts
{
  key: "openclaw.chatDock",
  label: "OpenClaw Chat Dock",
  description: "Show OpenClaw chat at the bottom of the HiveMatrix console.",
  defaultEnabled: false
}
```

Behavior:

- Default is always off.
- If OpenClaw discovery reports `installed:false`, the flag is forced off and cannot be enabled.
- If OpenClaw is installed but the Gateway is unreachable, the toggle is disabled by default with a status reason. A future advanced override can be considered, but the first implementation should stay conservative.
- If the feature was previously enabled and OpenClaw later disappears, HiveMatrix should auto-disable it at render time and show "OpenClaw not installed" in Settings.

## Discovery

Add a small server-side discovery module:

```text
src/lib/openclaw/discovery.ts
```

Responsibilities:

- Locate the `openclaw` binary:
  - `OPENCLAW_BIN` env override.
  - `command -v openclaw`.
  - `/opt/homebrew/bin/openclaw`.
  - `/usr/local/bin/openclaw`.
- Run `openclaw --version` with a short timeout.
- Read only non-secret config needed to locate the Gateway, if available.
- Probe Gateway health through an OpenClaw-supported local API when configured.
- Return a JSON-safe status object.

Do not read or return OpenClaw token values.

Response shape:

```json
{
  "installed": true,
  "enabled": false,
  "available": true,
  "version": "OpenClaw 2026.6.10 (aa69b12)",
  "gateway": {
    "reachable": true,
    "url": "ws://127.0.0.1:18789"
  },
  "reason": null
}
```

Missing binary:

```json
{
  "installed": false,
  "enabled": false,
  "available": false,
  "version": null,
  "gateway": null,
  "reason": "OpenClaw is not installed."
}
```

## Daemon API

Add endpoints under a narrow namespace:

```text
GET  /openclaw/status
GET  /openclaw/chat/history?sessionKey=agent:main:main
POST /openclaw/chat/send
POST /openclaw/chat/inject
POST /openclaw/chat/create-hivematrix-task
```

All endpoints require normal HiveMatrix bearer auth.

`GET /openclaw/status`

- Returns discovery + feature flag state.
- Never starts OpenClaw automatically in the first slice.
- Never returns OpenClaw auth secrets.

`GET /openclaw/chat/history`

- Uses the daemon bridge to request OpenClaw `chat.history`.
- Bounded result size.
- Returns display-ready messages only.
- If unavailable, returns a structured unavailable result rather than throwing a generic 500.

`POST /openclaw/chat/send`

Input:

```json
{
  "sessionKey": "agent:main:main",
  "message": "What should I look at next?",
  "idempotencyKey": "uuid"
}
```

Output:

```json
{
  "ok": true,
  "sessionKey": "agent:main:main",
  "runId": "..."
}
```

`POST /openclaw/chat/create-hivematrix-task`

Creates a HiveMatrix task from either selected OpenClaw text or a whole message reference.

Input:

```json
{
  "sessionKey": "agent:main:main",
  "messageId": "optional-openclaw-message-id",
  "text": "Turn this into a durable task...",
  "projectPath": "/Users/irvencassio/hivematrix"
}
```

Created HiveMatrix task fields:

```json
{
  "source": "openclaw-chat",
  "executor": "agent",
  "status": "backlog",
  "output": {
    "origin": "openclaw",
    "sessionKey": "agent:main:main",
    "messageId": "..."
  }
}
```

## Console UI

Add the dock to the main console area:

- Bottom-aligned panel, collapsed by default on first enable.
- Header: "OpenClaw" + availability dot + session selector.
- Body: compact transcript with user/assistant messages.
- Composer: single-line input that expands up to a small max height.
- Actions:
  - Send
  - Refresh
  - Collapse/expand
  - Create HiveMatrix Task from selected/last message

If disabled:

- Dock is not rendered.

If enabled but unavailable:

- Render a compact disabled panel or a settings warning, not a broken chat composer.
- Message: "OpenClaw is unavailable on this Mac." Include the discovery reason.

Settings:

- Show the feature under Settings -> Features or Integrations.
- Toggle states:
  - enabled toggle when installed + available;
  - greyed out when missing/unavailable;
  - off by default.

## Security

- HiveMatrix browser code never receives the OpenClaw gateway token.
- The bridge is same-machine only by default.
- Remote HiveMatrix clients talk to HiveMatrix, not directly to OpenClaw.
- OpenClaw messages may contain sensitive content; do not include OpenClaw history in general `/metrics`, `/health`, or task listings.
- Task creation from OpenClaw chat is explicit. No automatic conversion.
- Add a short audit log entry when OpenClaw chat creates a HiveMatrix task.

## Failure Modes

- OpenClaw not installed: feature forced off, greyed out.
- OpenClaw installed but gateway stopped: feature greyed out or disabled with reason.
- OpenClaw gateway starts after HiveMatrix: status endpoint detects availability on refresh; no daemon restart required.
- OpenClaw chat send times out: keep draft text, show retry.
- OpenClaw returns oversized history: bridge truncates safely and marks truncation.
- HiveMatrix task creation fails: show error and do not mark the message as handed off.

## Testing

Server tests:

- Discovery reports missing when binary cannot be found.
- Discovery reports installed from env override path.
- `GET /openclaw/status` requires HiveMatrix auth.
- Missing OpenClaw forces `openclaw.chatDock` off.
- Previously enabled feature is not rendered active when discovery is missing.
- Chat endpoints return structured unavailable responses when OpenClaw is absent.
- `create-hivematrix-task` creates a task with `source:"openclaw-chat"` and origin metadata.
- OpenClaw token/config secrets are never present in JSON responses.

Console tests:

- Toggle is off by default.
- Toggle is greyed out when `/openclaw/status.installed === false`.
- Dock is absent when disabled.
- Dock renders when enabled + available.
- Send button disables for empty input and while request is in flight.
- Create-task action calls the handoff endpoint and displays the returned HiveMatrix task id.

Verification gates:

```bash
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

`npx tsx scripts/qwen-readiness.mts` is not required unless the implementation touches local-model routing, Qwen serving, or readiness paths.

## HiveMatrix-iOS Impact

Brutally honest assessment: do not add native OpenClaw chat to HiveMatrix-iOS in this slice.

Reasons:

- The iPhone app already has a primary Talk tab for voice/text interaction with HiveMatrix. Adding OpenClaw chat creates a second assistant surface with different memory, session semantics, tools, and delivery behavior.
- Mobile is the least safe place to blur authority. A phone user may assume they are talking to HiveMatrix while actually driving OpenClaw, or vice versa.
- The OpenClaw chat bridge depends on the Mac's OpenClaw installation and Gateway state. That is a machine-local integration. Making it feel like a first-class phone feature would overpromise reliability.
- Exposing OpenClaw through HiveMatrix's remote tunnel expands the practical reach of OpenClaw's assistant surface. That may be acceptable later, but it deserves a separate security review and operator-visible scope controls.
- HiveMatrix-iOS should stay focused on board visibility, approvals, tasks, directives/flights, and voice control. Those are already durable HiveMatrix concepts.

Expected iOS behavior with this desktop implementation:

- iPhone native UI: no change.
- iPad desktop web console mode: if it loads the HiveMatrix daemon console and the feature is enabled, it may inherit the web dock. This is acceptable as a desktop-console behavior, not an iOS-native feature.
- Settings feature flag APIs may show the flag if the generic feature list is rendered. The Swift UI should treat unavailable/disabled feature flags as informational, not as a promise of native UI support.

If a future iOS slice is approved, the safer version is not a full OpenClaw chat tab. It should be one of:

1. Read-only OpenClaw availability/status in Settings.
2. A "Send to Mac OpenClaw" action hidden behind an explicit advanced integration toggle.
3. A HiveMatrix task handoff surface that still creates HiveMatrix tasks, not OpenClaw conversations.

No separate HiveMatrix-iOS spec is created for this proposal because the recommendation is no native iOS update.

## Open Questions

- Which OpenClaw session should the dock default to: `agent:main:main`, a dedicated `agent:main:hivematrix`, or a per-HiveMatrix-user session?
- Should HiveMatrix be allowed to start/restart OpenClaw, or should the first version only detect and report status?
- Should OpenClaw chat messages be persisted or cached by HiveMatrix, or always fetched live from OpenClaw?
- Should task handoff include a backlink to OpenClaw Control UI when available?

## Recommendation

Implement the desktop daemon bridge + native dock, feature-flagged off by default. Do not update HiveMatrix-iOS beyond any incidental shared feature-flag display. Keep OpenClaw as the conversational front door and HiveMatrix as the durable operations board.
