# Task Routing Control — Design

> Superpowers brainstorming artifact. Date: 2026-06-27.
> Fixes a real routing bug and adds an explicit Route selector to New Task so
> "developing tool X" is never confused with "using tool X".

## 1. Problem (observed)

A broad 27-item bug-list was submitted as a New Task. It contained a category
tally:

```
- Browser Lane: 5
- Terminal Lane: 4
- Video/HeyGen/workflows: 6
```

`isTerminalLaneRequest` matched the literal "Terminal Lane" (a *subject* of
development work), routed the whole prompt to the Terminal Lane, parsed "use" as
a hostname, and parked it in `review` / `needs_input: profile_missing`. Intake
had correctly classified it as a 27-item `work_package_candidate`, but the
keyword lane route runs first and won.

Two root causes:
1. **Greedy keyword matchers.** A bare *mention* of a lane name triggers its
   route. Mentioning a lane as the thing you're building ≠ asking to use it.
2. **No precedence for breadth.** A broad/multi-item prompt should become a Work
   Package even if it names a lane.

And the operator's framing: **"developing tool X" vs "using tool X"** must be
distinguishable — ideally explicitly, not only by heuristics.

## 2. Approach (two parts, one slice)

### Part A — Routing precedence fix (Auto mode)

In `POST /tasks` (the `route === "auto"` default path):
- Compute `broad = isBroadPrompt(description)` early.
- Gate the keyword lane/workflow routes (AI-news, Terminal Lane, YouTube) behind
  `!broad`. A broad prompt skips them → falls to intake → **Work Package**.
- **Tighten `isTerminalLaneRequest`**: require the "terminal lane" mention AND a
  use-cue (`use|using|via|through|route|run|ssh|connect|login|shell|exec`). A
  bare mention ("fix the Terminal Lane card", "Terminal Lane: 4") no longer
  routes. (All existing positive tests already contain a use-cue.)

Net: the reported bug-list → 27-item Work Package; a genuine "use Terminal Lane
to run uptime" (short, has a cue) → still routes to the lane.

### Part B — Explicit Route selector (New Task)

A `route` field on `POST /tasks`, surfaced as a dropdown in New Task:

| route | behavior |
|-------|----------|
| `auto` (default) | today's heuristics **with** Part A's precedence fix |
| `work_package` | force-stage a Work Package (model/deterministic decomposition; ≥1 item even if not "broad") |
| `terminal-lane` | force the Terminal Lane route (skip breadth/cue checks) |
| `normal` | plain agent task — skip ALL heuristics and intake promotion |

`normal` is the direct answer to "I'm *developing* the lane, don't route it
anywhere." `work_package` is the explicit "orchestrate this" button.

**Browser Lane forced-route is out of scope** for this slice: Browser Lane "use"
runs through COO dispatch / the Browser Lane app (readiness-gated), with no clean
single POST path. Adding a half-working option would be worse than omitting it;
noted as a follow-up. `normal`/`work_package` already cover *developing* Browser
Lane (the actual reported case).

## 3. Server changes (`server.ts` POST /tasks)

```
const route = body.route ?? "auto";
if (route === "normal") → derive title, plain Task.create (no special routes, no intake)
const broad = isBroadPrompt(description);
// AI-news:   route === "auto" && !broad && isAiNewsVideoRequest
// Terminal:  route === "terminal-lane" || (route === "auto" && !broad && isTerminalLaneRequest)
// YouTube:   route === "auto" && !broad && isYoutubeSummaryRequest
// Work pkg:  route === "work_package" → forceWorkPackage(...)
//            route === "auto"        → classifyIntakeAsync → if candidate, stage
// else:      plain Task.create
```

The work-package response is unchanged (`{routed:"work_package", packageId, …}`)
and the console already handles it (the create-failed fix shipped in 0.1.95).

## 4. classify.ts additions

- `export function deterministicFragments(description): string[]` — exposes the
  regex splitter (always ≥1 fragment).
- `export async function forceWorkPackage(input, deps?): Promise<{title, items}>`
  — returns a candidate even when the prompt isn't "broad": tries
  `classifyIntakeAsync` (model/deterministic), else builds items from
  `deterministicFragments` (or a single item = the whole prompt). Always ≥1 item.

## 5. Console (New Task)

A compact **Route** `<select id="t_route">` next to the model picker:
*Auto (recommended) / Work Package (orchestrate) / Terminal Lane / Normal task*.
`createTask` sends `route`. Default `auto` → byte-identical to today for normal
use. A short helper line: "Auto routes by content; pick Work Package to stage a
multi-step plan, or Normal to keep it a single task (e.g. when developing a lane
itself)."

## 6. Tests (TDD)

- `intent.test.ts`: a bare mention / tally ("Terminal Lane: 4", "fix the Terminal
  Lane card") → false; use-cue phrasings stay true (existing cases).
- `classify.test.ts`: `deterministicFragments` splits + always ≥1;
  `forceWorkPackage` yields ≥1 item for a non-broad prompt and re-stamps a
  release step as held.
- `server.test.ts`:
  - a broad prompt that NAMES a lane (contains "Terminal Lane: 4") → `routed:
    "work_package"`, NOT terminal-lane (the exact regression).
  - `route:"normal"` on a broad prompt → plain task (`_id`), no package, no lane.
  - `route:"terminal-lane"` forces the lane even for a plain prompt.
  - `route:"work_package"` on a non-broad prompt → a package is created.
  - existing Terminal Lane / YouTube / broad-auto tests stay green.
  - console source includes `id="t_route"` and `createTask` sends `route`.

## 7. Non-goals

- Forced Browser Lane routing (follow-up; needs the COO readiness path).
- Changing orchestration, intake classification, or the release pipeline.
