# Mail Lane Disabled Passive Status Design

Date: 2026-06-29
Status: Approved via operator-provided spec

## Problem

HiveMatrix can launch Apple Mail while Mail Lane is disabled because passive daemon status routes call `canControlMail()`. That helper executes AppleScript against `Mail.app`, and macOS may launch Mail as soon as AppleScript targets it.

The same disabled-state mismatch also appears in CLI-agent routing guidance: normal task prompts advertise Mail Lane and direct Apple Mail management even when the Mail Lane channel is disabled.

## Approaches Considered

### A. Patch Each Route Inline

Add `isChannelEnabled()` checks directly in `/onboarding` and `GET /mailbee`.

This is small, but it risks future drift because each route would rediscover the same passive/probing distinction.

### B. Centralize Mail Lane Status

Create a `getMailbeeStatus({ probe })` helper that reads channel state, allowlists, trusted domains, and triage configuration. Passive callers use `probe: false`; explicit setup/test callers use `probe: true`.

This keeps the disabled-channel behavior as the default shape and gives tests one clear seam for proving passive routes do not invoke AppleScript.

### C. Replace The Probe Implementation

Try to detect Automation permission without targeting Mail.

That would be ideal eventually, but it is riskier and outside this fix. The immediate bug is that passive UI/status code should not probe at all while disabled.

## Chosen Design

Use approach B.

- Add `src/lib/mailbee/status.ts`.
- Return `mailProbeSkipped: true` and `mailProbeReason: "channel_disabled"` when Mail Lane is disabled and the caller did not request a probe.
- Update `GET /mailbee` and `GET /onboarding` to use the helper passively.
- Add `POST /mailbee/probe` as the deliberate permission-test action.
- Keep `POST /mailbee/enable` as an explicit setup path that may still probe before enabling.
- Parameterize `outboundHttpRoutingPrompt()` so Mail guidance is emitted only when Mail Lane is enabled.
- Keep Message Lane guidance independent.

## Acceptance

- Passive status routes do not call `canControlMail()` while Mail Lane is disabled.
- Explicit `POST /mailbee/probe` still calls `canControlMail()`.
- CLI-agent prompt generation can omit Mail Lane send/read/manage instructions while disabled.
- Existing Mail Lane setup and send/draft paths remain available when enabled.
