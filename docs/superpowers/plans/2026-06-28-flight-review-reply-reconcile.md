# Flight Review Reply Reconcile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Add a failing server test in `src/daemon/server.test.ts`: create a two-item Flight, start it, force the first linked child into task/item `review`, POST `/tasks/:id/reply`, then assert the task is `backlog` and the linked Flight item is `running`.

- [x] Update the generic reply route in `src/daemon/server.ts`: after requeueing a replyable work-package child task, find its owning item/package and call `advanceWorkPackage(owner.packageId)`, mirroring the existing retry hook. Broadcast any created task and package update events.

- [x] Run focused tests for the server route, then run `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
