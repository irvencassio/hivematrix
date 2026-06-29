# Browser Lane Workflow Routing Design

Date: 2026-06-29
Status: Approved by attached operator bug report for the logged-in Browser Lane routing failure

## Context

The prompt `use Browser Lane to sign into LinkedIn and see if I have any friend requests` currently falls through to a normal dashboard task because `detectVoiceBrowserLaneIntent` only recognizes search/read/open shapes. The resulting agent treats Browser Lane as codebase context instead of as an execution lane, so no `source:"browser-lane"` task is created and `/lane/browser` never receives workflow arguments.

Browser Lane already has a stable workflow contract through `hivematrix_browser` and `/lane/browser`: `{"mode":"workflow","objective":"...","startUrl":"...","requiresLogin":true}`. The missing piece is deterministic intent detection for explicit logged-in workflow requests.

## Options Considered

1. Extend `detectVoiceBrowserLaneIntent` with a workflow mode.
   This is the smallest and safest path because both voice and `/tasks` already reuse the same detector and task builder. It keeps false-positive protection in one place.

2. Add a separate `/tasks`-only Browser Lane workflow detector.
   This would fix the dashboard failure but leave voice/push-to-talk with a different behavior contract.

3. Route all Browser Lane mentions through COO dispatch.
   This may be useful later, but it is broader than this bug and could blur the current explicit lane-routing guarantee.

## Decision

Use option 1.

Extend `VoiceBrowserLaneIntent` with `mode:"workflow"` and detect explicit Browser Lane lead-ins that ask to sign in/log in/check authenticated site state. Map common sites to useful start URLs:

- LinkedIn friend/invitation/connection requests -> `https://www.linkedin.com/mynetwork/invitation-manager/`
- Gmail unread/mail checks -> `https://mail.google.com/mail/u/0/#inbox`
- HeyGen status/video checks -> `https://app.heygen.com/home`

For other explicit logged-in Browser Lane prompts, derive a conservative workflow with `requiresLogin:true`, a readable objective, and a site URL when the site is recognizable from the text. Keep search/read/open behavior intact.

## Copy And State

Browser Lane task descriptions should say the task was explicitly created as Browser Lane workflow work. For `requiresLogin:true`, the description should state that an existing session may be required and that the operator must sign in or complete 2FA if Browser Lane reports missing login/session state. It should not read like a generic Claude coding task.

## Port Boundary

Generated Browser Lane loopback instructions must continue to point to the HiveMatrix daemon port, using `HIVEMATRIX_PORT` with a `3747` fallback. Desktop Lane helper references to `3748` are valid only for Desktop Lane health/helper copy, not for Browser Lane `/lane/browser` instructions.

## Non-Goals

- Do not automate password entry, cookies, TOTP, or other secrets.
- Do not route plain Browser Lane development tasks unless they explicitly ask to use Browser Lane as an execution lane.
- Do not change Browser Lane's execution engine selection or readiness policy.
- Do not deploy or release anything.

## Verification

- Failing tests first for workflow intent detection.
- `/tasks` regression test proving the LinkedIn prompt creates `source:"browser-lane"` with workflow args.
- False-positive tests for Browser Lane code/development tasks.
- Port-copy test proving generated Browser Lane task descriptions do not point `/lane/browser` at `3748`.
- Full gates: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.
