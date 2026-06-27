# Voice Logic Settings Diagnostic Design

## Context

HiveMatrix has good no-audio voice tests, but they are spread across developer test files. The operator expected a Settings-accessible voice diagnostic that runs canned utterances through the voice routing layer without invoking microphone capture, STT, TTS, or live audio playback.

## Goal

Add a Settings-facing "Voice logic test" in the existing Features panel. It should exercise deterministic voice routing with canned text scenarios and show pass/fail outcomes in the UI.

## Non-Goals

- Do not record audio.
- Do not run server-side STT.
- Do not synthesize or play audio.
- Do not create real tasks, resolve real approvals, send mail, delete mail, publish videos, or mutate live state.
- Do not require LM Studio or the Python sidecar.

## Design

Add a pure TypeScript scenario runner under `src/lib/voice/logic-scenarios.ts`. Each scenario provides an utterance plus stubbed dependencies. The runner calls the same production voice logic that `/voice/turn` calls after transcription:

- `skillTurnOverride`
- `videoVoiceOverride`
- `commandTurnOverride`
- `routeVoiceSession`

The runner injects `synthesize: async () => ""` and fake read/action dependencies. Any action-like behavior is recorded in memory as a simulated side effect, not applied to the real daemon database.

Add a daemon endpoint:

- `POST /settings/voice/test-scenarios`

The endpoint returns:

- `ok`
- `passed`
- `failed`
- `scenarios[]`

Each scenario includes:

- `name`
- `utterance`
- `expected`
- `actual`
- `passed`
- `reply`

Add the UI in Settings → Features near the Voice controls:

- Button: "Run voice logic test"
- Summary: passed/failed count
- Compact result rows with utterance, route, and reply

## UX Notes

The operator should be able to answer, "Is the voice routing brain working?" without touching the audio stack. The UI copy should be direct and operational, not explanatory marketing text.

