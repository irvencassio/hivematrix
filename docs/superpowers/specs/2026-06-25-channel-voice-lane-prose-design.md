# Channel And Voice Lane Prose Design

Date: 2026-06-25
Status: Approved by ongoing lane-name strategy

## Problem

Several historical decision notes and code comments still use old public channel, market, and voice names. Future agents read these notes/comments while deciding routes, so they should reinforce `Mail Lane`, `Message Lane`, `Voice Lane`, and `Market Insight Lane`.

## Decision

Update the prose surfaces to lane names while preserving compatibility symbols, route names, function names, and lower-case ids. This slice does not rename TypeScript APIs such as `executeMailBeeSend`, `startMessageBeePoller`, or `startTraderBeePoller`.

## Scope

- Update the Mail/Voice decision prose in `DECISIONS.md`.
- Update channel/voice/market comments in `src/lib/feedback/feedback.ts`, `src/lib/voice/tts.ts`, `src/lib/voice/session.ts`, and `src/daemon/index.ts`.
- Avoid changing exported names, file paths, route paths, compatibility ids, or test fixtures.

## Verification

Add a focused script test that checks those prose surfaces use lane names and do not reintroduce the old public phrases.
