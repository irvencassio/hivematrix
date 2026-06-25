# Channel And Voice Lane Prose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Task 1: Lock Channel And Voice Lane Prose

- [x] Add `scripts/channel-voice-lane-prose.test.mjs`.
- [x] Assert `DECISIONS.md` uses Mail Lane, Message Lane, and Voice Lane wording for the relevant decisions.
- [x] Assert selected source comments use Message Lane, Voice Lane, and Market Insight Lane wording.
- [x] Assert old public phrases are absent from those prose surfaces.
- [x] Run `npm test -- scripts/channel-voice-lane-prose.test.mjs` and confirm it fails before production changes.

## Task 2: Update Channel And Voice Lane Prose

- [x] Update `DECISIONS.md`.
- [x] Update `src/lib/feedback/feedback.ts`.
- [x] Update `src/lib/voice/tts.ts`.
- [x] Update `src/lib/voice/session.ts`.
- [x] Update `src/daemon/index.ts`.
- [x] Preserve compatibility ids, route names, function names, and exported TypeScript names.
- [x] Run `npm test -- scripts/channel-voice-lane-prose.test.mjs` and confirm it passes.

## Task 3: Verify And Ship

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Commit and push to `main`.
