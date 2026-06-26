# Voice Mail Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-26-voice-mail-delete-design.md`.

## Task 1 — RED: voice intent and command tests

- [x] Extend `src/lib/voice/command-intent.test.ts` with delete/trash email
      utterances and assert they produce a structured `mailDeleteTask` intent.
- [x] Extend `src/lib/voice/command-turn.test.ts` to assert the voice command
      creates one Mail Lane review task, carries safe metadata, and the spoken
      reply says no email was deleted.

## Task 2 — GREEN: detect Mail Lane delete voice requests

- [x] Add `mailDeleteTask` to `CommandKind`.
- [x] Add a `mailDelete` payload to `CommandIntent`.
- [x] Detect clear delete/trash email utterances before generic create-task.
- [x] Keep approval resolution words (`deny`, `reject`, `approve`) unchanged.

## Task 3 — GREEN: queue the deletion-review task

- [x] Add `buildVoiceMailDeleteTask`.
- [x] In `command-turn.ts`, create a review task with source `mail-lane`,
      project `inbox`, and explicit no-delete-yet copy.
- [x] Return a spoken response that makes the confirmation boundary obvious.

## Task 4 — Verify

- [x] Focused voice tests.
- [x] `npm run typecheck`.
- [x] `npm test`.
- [x] `node scripts/scope-wall.mjs`.
- [x] `npm run verify:portal`.
- [ ] Commit and push to `main`.
