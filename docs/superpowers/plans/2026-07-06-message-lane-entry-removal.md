# Message Lane Entry Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Add a failing console test for removable Message Lane setup chips.
  - Files: `src/daemon/console.test.ts`
  - Verification: `node --import tsx/esm --test src/daemon/console.test.ts` fails before the UI code exists.

- [x] Add remove controls to Message Lane setup chips.
  - Files: `src/daemon/console.ts`
  - Change: render existing allowlisted senders and self handles with remove controls.
  - Verification: focused console test passes.

- [x] Wire removal to existing daemon APIs.
  - Files: `src/daemon/console.ts`
  - Change: call `/messagebee/identities` with `status: "pending"` for sender removal and `/messagebee/self-handles` with the remaining set for self-handle removal.
  - Verification: focused console test proves the endpoint calls are present.

- [x] Run final gates.
  - Files: all changed files.
  - Verification: `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
