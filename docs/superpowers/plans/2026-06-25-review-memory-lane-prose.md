# Review And Memory Lane Prose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Tasks

- [x] Add a failing regression test in `scripts/review-memory-lane-prose.test.mjs` that reads the targeted files and asserts the new lane wording is present while old ManagerBee/BrainBee prose snippets are absent.
- [x] Update the targeted comments in `src/lib/managerbee/report.ts`, `src/lib/managerbee/heartbeat.ts`, `src/lib/brainbee/curate.ts`, `src/lib/brainbee/poller.ts`, and `src/lib/orchestrator/directive-store.ts`.
- [x] Run verification gates: `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
