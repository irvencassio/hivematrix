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

## Task 6 — Hotfix Talk reply audio for installed iOS builds

- [x] Reproduce that the daemon was sending a `.m4a` container with LPCM audio,
  which can yield text-only Talk replies on iOS.
- [x] Add a focused macOS TTS test proving `synthesizeSpeech(... engine: "say")`
  produces AAC audio for iOS playback.
- [x] Transcode the macOS `say` output through `afconvert` to AAC M4A before it
  is returned as `audioBase64`.
- [x] Restart the patched source daemon and verify `/flash/turn` now returns
  AAC audio (`afinfo` reports `Data format ... aac`).
- [x] Recycle the quick tunnel until the hostname resolves through the macOS
  system resolver, then regenerate the pairing QR.

Current hotfix tunnel: `https://nec-relying-university-saying.trycloudflare.com`.

## Task 7 — Fix `/voice/turn` JSON audio for iOS build 38

- [x] Confirm the attached iPhone has HiveMatrix `0.2.9` build `38`, which uses
  the JSON `/voice/turn` Talk path.
- [x] Reproduce that `/voice/turn` was putting the generated audio file path in
  `audioBase64`, producing unplayable bytes on iOS.
- [x] Patch `/voice/turn` to read the synthesized audio file and return actual
  base64 audio bytes.
- [x] Add a reliable `say` AAC fallback when the live Kokoro synth worker fails.
- [x] Verify local and public `/voice/turn` return an AAC M4A payload.
- [x] Regenerate the pairing QR for the current resolving quick tunnel.

Current hotfix tunnel: `https://remix-revealed-show-metallic.trycloudflare.com`.

## Task 8 — Saved city and live input follow-up

- [x] Add a daemon guard proving `/voice/turn` runs deterministic saved-location
  commands, such as weather, before falling back to the generic Flash model
  turn.
- [x] Patch `/voice/turn` so installed iOS builds that use the JSON Talk path
  get the same saved-location command behavior as `/flash/turn`.
- [x] Add an iOS settings guard proving location save errors are surfaced,
  successful saves reload daemon settings, and a saved city can be cleared.
- [x] Patch `/Users/irvcassio/hivematrix-ios/HiveMatrix/Views/SettingsView.swift`
  so Location save no longer silently swallows failures and no longer disables
  clearing the saved value.
- [x] Verify focused daemon and iOS tests.
- [x] Diagnose the live WebRTC Flash pipeline path where audio connects and
  greeting playback works, but spoken input does not reach the responder.
- [x] Patch the Flash realtime pipeline to emit VAD frames before segmented STT,
  then restart the source hotfix daemon.

## Task 9 — Fix empty live audio segments

- [x] Inspect the post-VAD realtime logs after an iPhone live attempt.
- [x] Identify that Pipecat `SegmentedSTTService` already passes a WAV segment
  into `run_stt()`, while the HiveMatrix adapters were wrapping that WAV inside
  another WAV as if it were raw PCM.
- [x] Patch `voice-sidecar/whisper_stt.py` and `voice-sidecar/realtime.py` to
  write the provided segment bytes directly.
- [x] Add a regression guard proving realtime STT adapters do not wrap Pipecat
  WAV segments again.
- [x] Restart the hotfix daemon/realtime sidecar and verify the next live
  attempt logs a transcript or a clear segment-size diagnostic.

## Task 10 — Fix live Flash SSE token handling

- [x] Reproduce that `/flash/turn` emits standard SSE as `event: token` followed
  by `data: {"delta": ...}`, while the realtime Flash processor only looked for
  an event type inside the JSON payload.
- [x] Add a regression guard proving `FlashLLMProcessor` remembers the SSE
  `event:` line and applies it to the following `data:` line.
- [x] Patch `voice-sidecar/flash_llm.py` so realtime voice speaks Flash tokens
  and completes turns instead of staying in listening state.
- [x] Restart the hotfix daemon/realtime sidecar and verify the Flash/RTC
  endpoints are reachable through the current quick tunnel; the phone live retry
  is the final device check.

## Task 11 — Fix realtime TTS audio context delivery

- [x] Inspect the iPhone live retry logs and confirm signaling/audio input reach
  the Mac, but Pipecat reports `unable to append audio to context` for reply
  audio frames.
- [x] Confirm Pipecat 1.3 `TTSAudioRawFrame` accepts a `context_id` and the
  HiveMatrix realtime TTS wrapper was not setting it.
- [x] Add a regression guard proving realtime TTS frames include the active
  `context_id`.
- [x] Patch `voice-sidecar/realtime.py` so every streamed TTS audio frame carries
  the current context id.
- [x] Restart the hotfix daemon/realtime sidecar and verify the quick tunnel
  reaches the restarted daemon; the next phone retry should confirm the
  audio-context append failures are gone.
