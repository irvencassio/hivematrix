# Browser Lane Workflow Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Make explicit logged-in Browser Lane workflow prompts create `source:"browser-lane"` tasks with
workflow args instead of falling through to a generic dashboard/agent task.

Root cause: `detectVoiceBrowserLaneIntent` previously only returned search/read/open shapes, and
`buildVoiceBrowserLaneTask` descriptions pointed at the wrong daemon port for some callers.

## Current State (as of 2026-06-29)

Most implementation is already in-progress on the working tree (all listed files are dirty):

| File | State |
|------|-------|
| `src/lib/voice/browser-lane-intent.ts` | Modified — `workflowIntent()` added, port guard in place |
| `src/lib/voice/browser-lane-intent.test.ts` | Modified — workflow tests written (TDD RED already set) |
| `src/daemon/server.ts` | Modified — `detectVoiceBrowserLaneIntent` wired into `/tasks` |
| `src/daemon/server.test.ts` | Modified — `/tasks` workflow routing tests written (TDD RED already set) |

**One known remaining bug:** The "connection requests" case in `workflowIntent()` at
`src/lib/voice/browser-lane-intent.ts` collapses "friend" and "connection" into the same
objective `"Check LinkedIn friend requests"`. The test at line 63 of
`browser-lane-intent.test.ts` expects `"Check LinkedIn connection requests"` for the
"open LinkedIn with Browser Lane and check connection requests" prompt — this case **fails**.

## Architecture

```
POST /tasks (description: "use Browser Lane to sign into LinkedIn…")
  └─ server.ts: detectVoiceBrowserLaneIntent(description)
       └─ browser-lane-intent.ts: stripLeadIn() → workflowIntent()
            └─ returns { mode:"workflow", objective:…, startUrl:…, requiresLogin:true }
  └─ server.ts: buildVoiceBrowserLaneTask(intent, …)
       └─ Task.create({ source:"browser-lane", … })
       └─ json(201, { routed:"browser-lane", mode:"workflow", taskId })
```

The `/lane/browser` curl instructions in task descriptions use `${HIVEMATRIX_PORT:-3747}` (not
the Desktop Lane helper port `3748`). The test asserts this with
`doesNotMatch(description, /127\.0\.0\.1:3748\/lane\/browser/)`.

## Task 1 — Fix LinkedIn "connection requests" Objective (the one remaining bug)

**File:** `src/lib/voice/browser-lane-intent.ts`

The current code around line 62 collapses "friend" and "connection requests" into a single
branch that always returns `"Check LinkedIn friend requests"`. Split it so each returns the
correct objective.

- [ ] Locate the LinkedIn block in `workflowIntent()` (~line 61):

```ts
if (/\b(friend|connection)\s+requests?\b/.test(lower)) {
  return {
    mode: "workflow",
    objective: "Check LinkedIn friend requests",   // ← bug: always "friend"
    startUrl: "https://www.linkedin.com/mynetwork/invitation-manager/",
    requiresLogin: true,
  };
}
```

- [ ] Replace it with two distinct branches:

```ts
if (/\bfriend\s+requests?\b/.test(lower)) {
  return {
    mode: "workflow",
    objective: "Check LinkedIn friend requests",
    startUrl: "https://www.linkedin.com/mynetwork/invitation-manager/",
    requiresLogin: true,
  };
}
if (/\bconnection\s+requests?\b/.test(lower)) {
  return {
    mode: "workflow",
    objective: "Check LinkedIn connection requests",
    startUrl: "https://www.linkedin.com/mynetwork/invitation-manager/",
    requiresLogin: true,
  };
}
```

- [ ] Confirm the `\binvitations?\b` branch below is unchanged (it was already distinct).
- [ ] Confirm the generic LinkedIn fallback `"Open LinkedIn workflow"` is unchanged.

## Task 2 — Verify Intent Detection Tests Pass (RED → GREEN)

- [ ] Run:
  ```bash
  npm test -- src/lib/voice/browser-lane-intent.test.ts
  ```
- [ ] Confirm all five cases in "detects explicit Browser Lane logged-in workflow requests" pass:
  - LinkedIn friend requests → `"Check LinkedIn friend requests"`
  - LinkedIn invitations → `"Check LinkedIn invitations"`
  - LinkedIn connection requests → `"Check LinkedIn connection requests"`
  - Gmail unread → `"Check Gmail unread mail"` / `https://mail.google.com/mail/u/0/#inbox`
  - HeyGen video status → `"Check HeyGen video status"` / `https://app.heygen.com/home`
- [ ] Confirm false-positive tests still pass (dev tasks return `null`).
- [ ] Confirm task-builder tests pass:
  - `task.source === "browser-lane"`
  - description matches `/Browser Lane workflow/`
  - description matches `/Requires login: yes/`
  - description matches `/operator/i`
  - description matches `/session|sign in|2FA/i`
  - description matches `/\/lane\/browser/`
  - description does NOT match `/127\.0\.0\.1:3748\/lane\/browser/`

## Task 3 — Verify Server Routing Tests Pass (RED → GREEN)

- [ ] Run:
  ```bash
  npm test -- src/daemon/server.test.ts
  ```
- [ ] Confirm "POST /tasks routes explicit logged-in Browser Lane workflows to Browser Lane" passes:
  - `body.routed === "browser-lane"`
  - `body.mode === "workflow"`
  - `row.source === "browser-lane"`
  - `row.description` matches `/Browser Lane workflow/` and `/Requires login: yes/`
  - `row.description` matches `/\/lane\/browser/` but NOT `/127\.0\.0\.1:3748\/lane\/browser/`
  - `output.browserLaneVoice.args` deepEquals the expected workflow args with `requiresLogin: true`
- [ ] Confirm "POST /tasks routes an explicit Browser Lane request to the lane (parity with voice)" still passes.
- [ ] Confirm "POST /tasks does not mis-route Browser Lane development work to Browser Lane" still passes for:
  - `"search the codebase for Browser Lane bugs"` → not browser-lane
  - `"fix Browser Lane icon size"` → not browser-lane
  - `"add tests for browser lane routing"` → not browser-lane

## Task 4 — Final Verification Gates

- [ ] Run full typecheck:
  ```bash
  npm run typecheck
  ```
  Zero errors expected.

- [ ] Run full test suite:
  ```bash
  npm test
  ```
  All tests pass.

- [ ] Run scope wall:
  ```bash
  node scripts/scope-wall.mjs
  ```
  Zero violations.

## Files Changed (complete list)

| File | Change |
|------|--------|
| `src/lib/voice/browser-lane-intent.ts` | Split LinkedIn "friend/connection requests" into two branches so each returns the correct objective. Everything else already in place. |
| `src/lib/voice/browser-lane-intent.test.ts` | Workflow detection tests (already written; no further edits expected). |
| `src/daemon/server.ts` | `/tasks` routing for `detectVoiceBrowserLaneIntent` (already wired; no further edits expected). |
| `src/daemon/server.test.ts` | Workflow routing regression tests (already written; no further edits expected). |

## Acceptance Criteria

1. `detectVoiceBrowserLaneIntent("use Browser Lane to sign into LinkedIn and see if I have any friend requests")` returns:
   ```json
   { "mode": "workflow", "objective": "Check LinkedIn friend requests", "startUrl": "https://www.linkedin.com/mynetwork/invitation-manager/", "requiresLogin": true }
   ```

2. `detectVoiceBrowserLaneIntent("open LinkedIn with Browser Lane and check connection requests")` returns:
   ```json
   { "mode": "workflow", "objective": "Check LinkedIn connection requests", "startUrl": "https://www.linkedin.com/mynetwork/invitation-manager/", "requiresLogin": true }
   ```

3. `POST /tasks` with description `"use Browser Lane to sign into LinkedIn and see if I have any friend requests"` responds `{ routed:"browser-lane", mode:"workflow" }` and the created task has `source:"browser-lane"`, `description` containing `"Browser Lane workflow"` and `"Requires login: yes"`, and `output.browserLaneVoice.args.requiresLogin === true`.

4. Task description curl instructions use `${HIVEMATRIX_PORT:-3747}`, not `3748`.

5. `"search the codebase for Browser Lane bugs"` → not a browser-lane task.

6. All three verification gates (`typecheck`, `npm test`, `scope-wall`) are green.

## Non-Goals

- Do not automate password entry, cookies, TOTP, or other secrets.
- Do not route plain Browser Lane development tasks unless explicitly using Browser Lane as a lane.
- Do not change Browser Lane's execution engine selection or readiness policy.
- Do not deploy or release anything.
