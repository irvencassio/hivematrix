# Browser Lane Trace Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Expose Browser Lane trace runs and events through safe read-only daemon and CLI paths.

## Constraints

- TDD first.
- Read-only only.
- Do not read Keychain secrets.
- Redact secret-looking fields from returned event payloads.

## Task 1: CLI Parsing

- [x] Add tests for `trace list`, `trace latest`, and `trace show <id>`.
- [x] Implement parser support in `src/lib/browser-lane/cli.ts`.
- [x] Update help text.

## Task 2: Store Trace Reads

- [x] Add tests for listing traces and fetching trace details/events.
- [x] Implement trace summary/detail helpers in `src/lib/browser-lane/store.ts`.
- [x] Redact secret-looking payload keys.

## Task 3: Daemon + Script Routes

- [x] Add daemon routes for trace list/latest/show.
- [x] Wire `scripts/hive-browser.mts`.

## Task 4: Verification

- [x] Run focused Browser Lane tests.
- [x] Run `npm run typecheck -- --pretty false`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [ ] Commit and push `main`.
