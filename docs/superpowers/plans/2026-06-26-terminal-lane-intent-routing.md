# Terminal Lane Intent Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-26-terminal-lane-intent-routing-design.md`

## Task 1 — RED: intent + route tests

- [ ] `src/lib/terminal-lane/intent.test.ts`: `isTerminalLaneRequest` true for
  "use TerminalLane…", "Terminal Lane", "use terminal lane"; false for unrelated;
  `detectTerminalHostHint` extracts "aiserver" from host-targeted phrasing.
- [ ] `src/lib/terminal-lane/route.test.ts`: `resolveTerminalProfileForQuery`
  matches id/displayName/host; `routeTerminalLaneRequest` — aiserver prepared,
  needs_input when missing, structured transcript, no Canopy, no secrets.
- [ ] Run → fail.

## Task 2 — GREEN: intent.ts + route.ts

- [ ] `intent.ts`: pure `isTerminalLaneRequest(text)`, `detectTerminalHostHint(text)`.
- [ ] `route.ts`: `resolveTerminalProfileForQuery(query, profiles)` (non-secret
  projection); `routeTerminalLaneRequest({text, profiles})` returning the
  structured result + transcript + reasons; well-known "OS version" → suggested
  read-only command.
- [ ] Run → green.

## Task 3 — RED→GREEN: POST /tasks wiring

- [ ] `scripts/terminal-lane-route.test.mjs`: server.ts imports
  `isTerminalLaneRequest`/`routeTerminalLaneRequest`, creates
  `executor:"terminal-lane"` (not agent), seeds transcript logs; gated like the
  video route.
- [ ] server.ts: add the terminal short-circuit after the video check.
- [ ] Run → green.

## Task 4 — RED→GREEN: routing-guide override

- [ ] Extend `src/lib/orchestrator/outbound-routing.test.ts`: `beeToolsRoutingPrompt`
  says Terminal Lane is canonical + Canopy optional/legacy-only + explicit
  Terminal Lane must use HiveMatrix tools.
- [ ] `outbound-routing.ts`: add the override copy. Run → green.

## Task 5 — Goal 4 regression (keep/confirm)

- [ ] Confirm `scripts/lane-app-versioning.test.mjs` asserts version advanced past
  `0.1.1 (2)`; `status.test.ts`/`index.test.ts` cover stale-copy + shadow. (Already
  present from b622b53 — no new code.)

## Task 6 — Gates + rebuild + smoke + push

- [ ] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`,
  `node --import tsx/esm scripts/release-smoke.mjs`.
- [ ] `node scripts/package-terminal-lane-app.mjs`; confirm bundled `0.1.2 (3)`.
- [ ] Manual smoke: route "use TerminalLane and check the OS version of aiserver"
  through `routeTerminalLaneRequest` against the live profiles; confirm prepared +
  aiserver + no Canopy.
- [ ] Commit; push to main; report hash + smoke result.
