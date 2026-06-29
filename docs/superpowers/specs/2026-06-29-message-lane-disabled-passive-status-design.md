# Message Lane Disabled Passive Status Design

Date: 2026-06-29
Status: Approved via operator request

## Problem

Message Lane already has a disabled-channel guard in its poller, so the background loop does not continuously read Messages or send replies when the lane is off.

However, passive status surfaces still probe `~/Library/Messages/chat.db` while Message Lane is disabled, and outbound agent surfaces still advertise iMessage send capability. A disabled lane should mean HiveMatrix does not touch Messages data or offer send tools except through explicit setup/test actions.

## Chosen Design

- Add `src/lib/messagebee/status.ts` to centralize passive Message Lane status.
- Make passive status skip `probeChatDbAccess()` when disabled and return `chatDbProbeSkipped: true`.
- Add `POST /messagebee/probe` for deliberate Full Disk Access/readiness testing.
- Update `GET /messagebee`, `GET /onboarding`, and lane service status to avoid passive probes while off.
- Gate `/messagebee/send`, local lane-tool sending, outbound prompt text, and outbound MCP tool exposure by Message Lane enabled state.
- Keep `POST /messagebee/enable` and setup actions as explicit paths that may still probe before enabling.

## Acceptance

- With Message Lane disabled, passive status endpoints do not open/probe `chat.db`.
- With Message Lane disabled, normal agent prompts and MCP tools do not advertise iMessage sending.
- With Message Lane disabled, `/messagebee/send` refuses before invoking Messages.
- With Message Lane enabled, explicit probe/setup/send behavior remains available.
