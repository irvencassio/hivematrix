# Decisions Settings Lane Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Tasks

- [x] Add a failing regression test in `scripts/decisions-settings-lane-copy.test.mjs` for the targeted `DECISIONS.md` phrases.
- [x] Update the targeted `DECISIONS.md` prose to use lane naming.
- [x] Run verification gates: `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
