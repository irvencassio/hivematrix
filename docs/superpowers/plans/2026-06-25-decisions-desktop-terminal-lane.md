# Decisions Desktop And Terminal Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Tasks

- [x] Add a failing regression test in `scripts/decisions-desktop-terminal-lane.test.mjs` that checks `DECISIONS.md` teaches Desktop Lane and Terminal Lane while preserving compatibility routes/types.
- [x] Update the targeted Q1 and runtime-registration prose in `DECISIONS.md`.
- [x] Run verification gates: `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
