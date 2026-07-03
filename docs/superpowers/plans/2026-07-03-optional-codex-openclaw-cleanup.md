# Optional Codex And OpenClaw Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Design Reference

- `docs/superpowers/specs/2026-07-03-optional-codex-openclaw-cleanup-design.md`

## Task 1 — RED: Tests

- [x] Add resolver tests proving missing Codex falls back to Claude and both-missing returns null.
- [x] Add onboarding tests proving Codex CLI is an optional setup step with install/login guidance.
- [x] Add feature visibility tests proving OpenClaw Chat is hidden when OpenClaw is not installed.
- [x] Add console tests proving the Codex setup action opens the model setup step.

Run focused tests and observe RED.

## Task 2 — GREEN: Implementation

- [x] Update model resolver to consider configured frontier backends.
- [x] Add optional Codex CLI onboarding/setup step.
- [x] Add Settings Setup action for Codex CLI.
- [x] Add feature visibility helper and use it in `/settings/features`.

Run focused tests and observe GREEN.

## Task 3 — Verification

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Run `npx tsx scripts/qwen-readiness.mts`.
