# iOS Talk Flash Timeout Design

> Date: 2026-07-04 · Status: proposed · Topic: ios-talk-flash-timeout

## Problem

The attached iPhone screenshot shows the Talk screen sending the recognized text
`What is the weather today` and then surfacing a raw URLSession timeout:

`NSURLErrorDomain Code=-1001 "The request timed out."`

The failing URL is the temporary Cloudflare tunnel endpoint
`POST /flash/turn`. The iOS Talk implementation in
`/Users/irvcassio/hivematrix-ios/HiveMatrix/Views/VoiceTalkView.swift` currently
posts on-device speech transcripts to the Flash Lane SSE endpoint. That route
does not run the existing deterministic voice command overrides, so the already
implemented weather path under `src/lib/voice/command-turn.ts` is bypassed.

Two separate issues are tangled together:

1. `/flash/turn` is an SSE stream, but the daemon may not write any bytes until
   the local model begins producing tokens. Through a Cloudflare tunnel and
   iOS `URLSession.bytes(for:)`, a long silent first byte can become a timeout.
2. Weather is already solved in the `/voice/turn` text path. It reads the
   operator location from HiveMatrix settings, calls the keyless weather helper,
   replies inline, and suppresses generic task creation. iOS Talk currently does
   not use that path.

## Goal

Make the iPhone Talk flow answer transcript-based voice commands reliably,
including "What is the weather today?", without requiring microphone debugging
or server-side STT. Keep the existing on-device speech recognition UX.

## Approaches

### Approach A: Server-side SSE heartbeat only

Write an immediate SSE comment or `ready` event when `/flash/turn` accepts the
request, then continue streaming model tokens as today.

Pros:

- Small daemon-only change.
- Keeps live token streaming on iOS.
- Helps all `/flash/turn` clients behind tunnels.

Cons:

- Does not route weather through the deterministic voice command layer.
- The app can still wait on a slow or unavailable local model for simple voice
  commands that should be instant.
- No spoken audio is returned unless `/flash/turn` grows a voice-specific audio
  contract.

### Approach B: iOS Talk uses `/voice/turn` text for push-to-talk

Change transcript-based iOS Talk sends to call the existing `voiceTurnText`
client method (`POST /voice/turn` with `{ text, lang }`). That endpoint already
runs command and skill overrides before falling through to Flash text mode, and
it returns the established `{ transcript, reply, audioBase64 }` JSON contract.

Pros:

- Fixes the weather request by using the already tested weather command path.
- Preserves on-device speech recognition; no audio upload or server-side STT.
- Restores spoken replies through the existing `audioBase64` response.
- Smaller iOS change with focused tests around endpoint selection and response
  handling.

Cons:

- Loses live token streaming for normal Talk turns.
- Longer non-command model turns can still be limited by one long JSON request,
  though they use the `/voice/turn` timeout and existing fallback behavior.

### Approach C: Do both, in a narrow form

Use `/voice/turn` text for iOS push-to-talk commands and add an immediate
heartbeat/comment to `/flash/turn` so any remaining Flash clients avoid the
silent-first-byte timeout.

Pros:

- Weather and command turns use the right voice path.
- Flash streaming becomes more robust for console and future clients.
- Keeps the fix small on both sides.

Cons:

- Touches both repositories/areas, so verification has a wider surface.
- The heartbeat does not by itself make Flash voice-aware; it is transport
  hardening, not the main command fix.

## Recommended Design

Use Approach C, but keep the first implementation deliberately small:

1. In the iOS app, update `VoiceTalk.send(api:)` to call `api.voiceTurnText`
   instead of `api.flashTurn`.
2. Preserve the UI state machine: `processing` while the JSON request is
   in-flight; no `streaming` state for this path; update `reply`; store and play
   `audioBase64` when present; keep `sessionId` untouched because `/voice/turn`
   does not currently return a Flash session id.
3. Add or extend iOS tests proving `voiceTurnText` posts to `/voice/turn` with
   `{ "text": "...", "lang": "en" }`, uses bearer auth, and decodes
   `VoiceTurnResult`.
4. In the daemon, optionally write an immediate SSE keepalive/comment in the
   `/flash/turn` route after `writeHead`, before awaiting the local model. This
   is a defensive transport fix and should not alter event semantics.

## Non-Goals

- Do not rework the live Pipecat voice view.
- Do not change the weather service, intent detection, or location source.
- Do not add a new iOS screen.
- Do not upload microphone audio for this push-to-talk path.
- Do not expose raw daemon error dumps in the normal Talk UI if a cleaner error
  message is available.

## Acceptance Criteria

- iPhone Talk sends transcript text to `/voice/turn`, not `/flash/turn`.
- A weather transcript uses the daemon's existing voice command override and can
  return an inline spoken/text reply.
- The Talk screen displays the reply and plays returned audio when present.
- Existing local edits in both worktrees are preserved.
- Focused tests pass in the iOS repo, plus the daemon Flash route test or a
  focused smoke if the keepalive is implemented.
- For daemon changes, the repository gates remain available:
  `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`; local-model
  readiness is only required if local-model files change.
