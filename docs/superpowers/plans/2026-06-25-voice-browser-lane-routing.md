# Voice Browser Lane Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

## Goal

Make explicit spoken Browser Lane requests create Browser Lane tasks instead of generic voice tasks that may use a frontier model's own web search.

## Task 1: Add Failing Parser Tests

- [x] Add `src/lib/voice/browser-lane-intent.test.ts`.
- [x] Cover `use browser lane to search Tesla Model S price` → `{ mode:"search", query:"Tesla Model S price" }`.
- [x] Cover `browser lane read https://example.com pricing` → read mode with URL and query.
- [x] Cover `use browser lane to open https://google.com` → open mode.
- [x] Cover unrelated utterances → null.
- [x] Confirm RED.

## Task 2: Implement Pure Intent And Task Description Helpers

- [x] Add `src/lib/voice/browser-lane-intent.ts`.
- [x] Export `detectVoiceBrowserLaneIntent`.
- [x] Export `buildVoiceBrowserLaneTask`.
- [x] Keep outputs secret-free; do not accept password/token/cookie-looking input keys.
- [x] Include `/lane/browser` loopback instructions in the task description.

## Task 3: Wire Full Voice Session Handoff

- [x] Extend `VoiceHandoff` with `{ kind:"browserLaneTask", ... }`.
- [x] In `routeVoiceSession`, prefer explicit Browser Lane intent before generic substantive task routing.
- [x] Update `/voice/session` DB glue to persist source `browser-lane` with `output.voice` and `output.browserLaneVoice`.
- [x] Update background escalation task creation in `/voice/turn` similarly.

## Task 4: Wire Push-To-Talk Command Override

- [x] Add `browserLaneTask` to `CommandKind`.
- [x] Detect explicit Browser Lane intent in `detectCommandIntent`.
- [x] In `commandTurnOverride`, create the same Browser Lane task payload and speak a clear "queued Browser Lane" reply.
- [x] Broadcast `tasks:created` remains unchanged through existing `taskId` return.

## Task 5: Verify

- [x] Run focused voice tests.
- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
