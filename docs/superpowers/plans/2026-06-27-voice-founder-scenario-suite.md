# Voice Founder Scenario Suite + Weather Geocode Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-27-voice-founder-scenario-suite-design.md`

- [x] RED: add weather tests showing `Kings Mills, OH` searches city-only and
      prefers Ohio, plus `San Francisco, CA` prefers California.
- [x] GREEN: update `src/lib/voice/weather.ts` geocoding to normalize common US
      state suffixes and choose the best matching result.
- [x] RED: expand `src/lib/voice/logic-scenarios.test.ts` to require at least
      50 passing scenarios, no audio bytes, no secrets, and no real mutations.
- [x] GREEN: update `src/lib/voice/logic-scenarios.ts` with founder/personal
      scenario coverage and safe dependency stubs; support injectable/live
      weather so the Settings diagnostic can catch saved-location geocode issues.
- [x] Update daemon endpoint/UI copy only if needed for the larger suite.
- [x] Verify focused tests, `npm run typecheck`, `npm test`, and
      `node scripts/scope-wall.mjs`.
