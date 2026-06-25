# Voice Browser Lane Routing Design

Date: 2026-06-25
Status: Approved by operator bug report: voice "Use Browser Lane to search ..." did not start the expected Browser Lane task

## Context

Live daemon inspection showed that the spoken request did create a generic voice task:

`Voice: Use browser lane to search Tesla model S price`

But the spawned frontier worker used its own `WebSearch` tool instead of Browser Lane. From the operator's perspective this looks like Browser Lane never started, because no Browser Lane task/source appears and the explicit "use Browser Lane" instruction is not enforced.

## Decision

Add a deterministic voice Browser Lane intent:

- Detect explicit phrases like `use browser lane to search X`, `browser lane search X`, `use browser lane to read URL`, and `use browser lane to open URL`.
- Route these to a Browser Lane task payload instead of a generic voice task.
- Preserve the voice transcript metadata in `output.voice`.
- Store Browser Lane request metadata in `output.browserLaneVoice.args`.
- Set `source: "browser-lane"` so the task is visible as Browser Lane work on the board.
- Include explicit loopback `/lane/browser` instructions in the task description so a spawned worker uses the daemon-controlled Browser Lane endpoint instead of improvising with WebSearch/Chrome.

## Non-Goals

- Do not execute the web search inside the voice HTTP request.
- Do not add browser credential fill or login automation.
- Do not route ambiguous generic web questions to Browser Lane; only explicit Browser Lane phrases get this deterministic path.

## Verification

- Unit tests for intent parsing.
- Unit tests for full voice session routing.
- Unit tests for push-to-talk command override task creation.
- Existing voice tests remain green.
- Full repo gates: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.
