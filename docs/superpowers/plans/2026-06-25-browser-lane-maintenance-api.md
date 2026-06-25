# Browser Lane Maintenance API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Add the minimal metadata-only maintenance API and CLI needed to seed Browser Lane sites/probes and then run `/browser-lane/probe`.

## Constraints

- TDD first.
- Do not accept inline secrets.
- Do not read Keychain values.
- Keep the API metadata-only.

## Task 1: CLI Parsing

- [x] Add failing tests for `sites list`, `sites add`, and `probes add`.
- [x] Implement parser support in `src/lib/browser-lane/cli.ts`.
- [x] Update help text.

## Task 2: Store Summaries

- [x] Add tests that site listing includes probe counts without secrets.
- [x] Implement list summary helper in `src/lib/browser-lane/store.ts`.

## Task 3: Daemon + Script Routes

- [x] Add daemon routes for listing/upserting sites and probes.
- [x] Wire `scripts/hive-browser.mts` to call those routes.
- [x] Return stable JSON for CLI use.

## Task 4: Verification

- [x] Run focused Browser Lane tests.
- [x] Run `npm run typecheck -- --pretty false`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [ ] Commit and push `main`.
