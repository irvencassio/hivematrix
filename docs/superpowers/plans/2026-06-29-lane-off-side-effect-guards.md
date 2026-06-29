# Lane-Off Side-Effect Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Task 1: Mail Lane outbound tools refuse while disabled.
  - Files: `src/lib/orchestrator/lane-tools.test.ts`, `src/lib/orchestrator/lane-tools.ts`.
  - Failing test first: add tests where `MailBeeSendIO.isChannelEnabled` returns false and assert `executeMailBeeSend` / `executeMailBeeDraft` return disabled errors without `send` or `draft` calls.
  - Implementation: add optional `isChannelEnabled` to `MailBeeSendIO`, wire default to `mailbee/store.isChannelEnabled`, and check it before trust/draft/send logic.

- [x] Task 2: Notification fallback respects lane enabled state.
  - Files: `src/lib/notify/notify.test.ts`, `src/lib/notify/notify.ts`.
  - Failing test first: inject fake dependencies and assert email/iMessage targets are skipped when their lane-enabled callbacks return false.
  - Implementation: make `notify` use injectable/default dependencies for Telegram, iMessage, email, and lane enabled checks; only call local app senders when the corresponding lane is enabled.

- [x] Task 3: Mail readiness probe does not launch Mail passively.
  - Files: `src/lib/mailbee/applemail.test.ts`, `src/lib/mailbee/applemail.ts`, `src/lib/mailbee/status.ts`, `src/daemon/server.ts`, `src/lib/onboarding/actions.ts`.
  - Failing test first: inject an app-running checker and script runner; assert `canControlMail()` returns false without AppleScript when Mail is closed, and assert an explicit launch-allowed call does run the script.
  - Implementation: add `isMailAppRunning()` and `canControlMail(timeoutMs, { allowLaunch?: boolean })`; use `allowLaunch:true` only in `/mailbee/probe`, `/mailbee/enable`, and guided setup.

- [x] Task 4: Message Lane test-send refuses while disabled.
  - Files: `src/daemon/server.test.ts`, `src/daemon/server.ts`.
  - Failing test first: request `/messagebee/test-send` against a temp DB with Message Lane disabled and assert no send occurs and response is 400.
  - Implementation: check `messagebee/store.isChannelEnabled()` before importing/calling `sendIMessage`.

- [x] Task 5: Flight review labels are clearer.
  - Files: `src/daemon/console.test.ts`, `src/daemon/console.ts`.
  - Failing test first: update the board card test to expect `Flight Review` / `awaiting accept` and not `Blocks Flight`.
  - Implementation: change `flightContextBadge` copy for `itemStatus === "review"`.

- [x] Task 6: Verify gates.
  - Run `npm run typecheck`.
  - Run `npm test`.
  - Run `node scripts/scope-wall.mjs`.
  - Check `git diff` to ensure existing console edits were preserved.
