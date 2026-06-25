# Browser Lane Readiness Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Replace the `/browser-lane/probe` `501` stub with a DB-backed readiness runner that can be used by the CLI and future Browser Lane app.

## Constraints

- TDD first.
- Do not read Keychain secret values.
- Persist metadata, run state, and trace events only.
- Default browser adapter may remain unavailable, but must produce a persisted blocked run instead of a stub response.

## Task 1: Browser Lane Store

- [x] Add tests for upserting/listing browser sites and probes.
- [x] Implement `src/lib/browser-lane/store.ts`.
- [x] Ensure credential rows store only `credentialRef`.

## Task 2: Probe Service

- [x] Add tests for running all configured probes with an injected fake adapter.
- [x] Add tests for the default unavailable adapter producing persisted blocked runs.
- [x] Implement `src/lib/browser-lane/probe-service.ts`.
- [x] Persist readiness runs and trace events.

## Task 3: Daemon Route

- [x] Replace `/browser-lane/probe` 501 with the probe service.
- [x] Return 404 only when no configured site matches.
- [x] Return 200 with run summaries when probes execute, even if a backend marks them blocked.

## Task 4: Verification

- [x] Run focused Browser Lane tests.
- [x] Run `npm run typecheck -- --pretty false`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [ ] Commit and push `main`.
