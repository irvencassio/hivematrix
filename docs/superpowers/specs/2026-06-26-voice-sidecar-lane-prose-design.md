# Voice Sidecar Lane Prose Design

## Context

The full HiveMatrix test suite currently fails `scripts/voice-sidecar-lane-prose.test.mjs` because `voice-sidecar/llm.py` no longer contains the expected lane-name comment text for Mail Lane. This is a source-prose regression, not a behavior change.

## Goal

Restore lane-native comments in the voice sidecar without changing runtime behavior.

## Verification

- `node --test scripts/voice-sidecar-lane-prose.test.mjs`
- Full `npm test`
