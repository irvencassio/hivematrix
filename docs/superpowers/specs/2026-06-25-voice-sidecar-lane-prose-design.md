# Voice Sidecar Lane Prose Design

## Context

The voice stack is now publicly named Voice Lane, and email capability copy should use Mail Lane. A few source comments still teach old Bee names in places that future agents and maintainers will read:

- `src/daemon/server.ts` describes `/voice/session` as coming from the VoiceBee sidecar.
- `voice-sidecar/llm.py` describes direct Mail reading and send-gated actions through MailBee.

These are prose-only leaks. Compatibility routes and implementation names should remain stable for now.

## Decision

Update the comments to use:

- `Voice Lane sidecar`
- `Mail Lane`

Preserve:

- `/voice/session`
- `/mailbee/send`
- `/mailbee/draft`
- all imported function names and compatibility route names
- Python behavior and tool schema

## Acceptance Criteria

1. `src/daemon/server.ts` contains `Voice Lane sidecar` near the `/voice/session` route.
2. `voice-sidecar/llm.py` describes the mail surface as `Mail Lane`.
3. The targeted files no longer contain `VoiceBee`, `surface MailBee uses`, or `daemon's MailBee`.
4. Verification gates pass: `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
