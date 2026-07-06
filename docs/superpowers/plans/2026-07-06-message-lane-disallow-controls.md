# Message Lane Disallow Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [ ] Add failing coverage for the setup modal disallow workflow.
  - File: `src/daemon/console.test.ts`
  - Assert the modal has a blocked-list mount, ignored sender rows include `Disallow`, and JavaScript includes block/allow/unblock handlers.

- [ ] Add failing coverage for blocked identity matching.
  - File: `src/lib/messagebee/store.test.ts`
  - Insert a blocked identity and assert it matches `isBlocked` while staying out of `isAllowed`.

- [ ] Add failing coverage for poller suppression.
  - File: `src/lib/messagebee/poller.test.ts`
  - Assert the poller checks `isBlocked` before recording ignored senders.

- [ ] Implement blocked identity store and poller suppression.
  - Files: `src/lib/messagebee/store.ts`, `src/lib/messagebee/poller.ts`
  - Export `isBlocked(handle)` and skip `recordIgnoredSender` when it matches.

- [ ] Implement identity status cleanup on server writes.
  - File: `src/daemon/server.ts`
  - Clear ignored sender entries when an identity is allowed or blocked.

- [ ] Implement setup modal controls.
  - File: `src/daemon/console.ts`
  - Add `Disallow` action, blocked identity chips, and allow/unblock handlers.

- [ ] Verify and ship.
  - Run targeted tests.
  - Run `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
  - Commit on `main`, run the autodeploy build, and update first-install DMG redirect if a new release is created.
