# Task Routing Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-27-task-routing-control-design.md`.
TDD throughout. Gates: typecheck, npm test, scope-wall. Then release (operator asked).

---

## Task 1 — Tighten Terminal Lane intent (RED → GREEN)

- [ ] Extend `src/lib/terminal-lane/intent.test.ts`: a bare mention / tally
      ("Terminal Lane: 4 bugs", "fix the Terminal Lane readiness card") → false;
      keep all existing use-cue positives true.
- [ ] Run, watch the new negatives fail.
- [ ] Add a use-cue requirement to `isTerminalLaneRequest`.
- [ ] Watch pass.

## Task 2 — classify helpers (RED → GREEN)

- [ ] Tests in `src/lib/intake/classify.test.ts`: `deterministicFragments`
      returns ≥1 and splits a comma list; `forceWorkPackage` returns ≥1 item for
      a non-broad prompt and stamps a release step held.
- [ ] Run, watch fail.
- [ ] Export `deterministicFragments` + `forceWorkPackage` from classify.ts.
- [ ] Watch pass.

## Task 3 — Server routing precedence + route field (RED → GREEN)

- [ ] server.test.ts: broad prompt naming a lane → work_package (regression);
      route:normal → plain task; route:terminal-lane forces lane;
      route:work_package on a non-broad prompt → package.
- [ ] Run, watch fail.
- [ ] In POST /tasks: parse `route`; gate AI-news/Terminal/YouTube behind
      `!broad` (auto) or honor explicit route; add work_package + normal routes.
- [ ] Watch pass; existing POST /tasks tests stay green.

## Task 4 — New Task Route selector (RED → GREEN)

- [ ] server.test.ts (console source): includes `id="t_route"` and createTask
      sends `route`.
- [ ] Run, watch fail.
- [ ] Add the `<select>` + helper line in console.ts; send `route` in createTask.
- [ ] Watch pass.

## Task 5 — Gates, ship

- [ ] typecheck, npm test, scope-wall — all clean.
- [ ] COMPONENT-MAP note (routing control).
- [ ] Commit + push to main.
- [ ] Release via scripts/release.mjs; report tag + feed proof.
