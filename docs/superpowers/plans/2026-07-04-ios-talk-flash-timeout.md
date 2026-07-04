# iOS Talk Flash Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-07-04-ios-talk-flash-timeout-design.md`.

## Task 1 — RED: iOS Talk endpoint tests

- [x] In `/Users/irvcassio/hivematrix-ios/HiveMatrixTests/SmokeTests.swift`, add a focused APIClient test proving `voiceTurnText(text:)` posts JSON to `/voice/turn`, includes bearer auth, carries `text` and `lang`, and decodes `VoiceTurnResult`.
- [x] Add a source-level guard test proving `VoiceTalkView.swift` no longer calls `api.flashTurn` from the push-to-talk send path and does call `api.voiceTurnText`.
- [x] Run the focused iOS unit tests and confirm the guard fails before the production change.

## Task 2 — GREEN: route iOS Talk through `/voice/turn`

- [x] Update `/Users/irvcassio/hivematrix-ios/HiveMatrix/Views/VoiceTalkView.swift` so `VoiceTalk.send(api:)` calls `api.voiceTurnText(text:lang:)`.
- [x] Preserve the user-facing state: `processing` is true while the request runs; `streaming` is false; `reply` is set from the JSON response; returned `audioBase64` is stored and played.
- [x] Keep existing user edits in `VoiceTalkView.swift` intact.

## Task 3 — GREEN: Flash keepalive

- [x] Add a focused daemon test or source guard that `/flash/turn` writes an immediate SSE keepalive/comment before awaiting the Flash agent loop.
- [x] Update `/Users/irvcassio/hivematrix/src/daemon/server.ts` to emit that keepalive right after the SSE headers.

## Task 4 — Verify and run on device

- [x] Run focused iOS tests.
- [x] Run focused daemon tests or source guard.
- [x] Run practical build checks for the iOS app.
- [x] If a connected iPhone is visible and signing succeeds, install/run the updated app on the device.
- [x] Report any remaining manual step only if device deployment is blocked.

Device note: the iPhone `Hollywood` is visible, but device build/install is
blocked by signing. The keychain has Developer ID and Apple Distribution
identities, not an Apple Development identity with private key, and Xcode found
no matching iOS development provisioning profile for
`com.irvcassio.hivematrix.app`.

## Task 5 — Hotfix the currently installed iPhone build

- [x] Add a daemon compatibility branch so old iOS Talk builds that still send
  `channel: "voice"` to `/flash/turn` run the deterministic voice command
  override before the Flash agent loop.
- [x] Store the resulting voice command turn in the Flash session and return an
  SSE token plus done event with the same session id shape the old client
  expects.
- [x] Run the patched source daemon on the live `127.0.0.1:3747` endpoint so
  the existing phone/tunnel setup can work before iOS signing is fixed.
- [x] Verify the live `/flash/turn` request returns bytes promptly instead of
  timing out.

Hotfix note: the bundled launch agent `com.hivematrix.daemon` was temporarily
booted out because it kept restarting the old daemon. The patched source daemon
is running as a launchd-submitted job on `127.0.0.1:3747`, with logs at
`~/.hivematrix/logs/dev-daemon-hotfix.log`. A fresh quick tunnel is available at
`https://kim-quad-founded-preliminary.trycloudflare.com`.
