# Channel Source Lane Prose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Tasks

- [x] Add a failing regression test in `scripts/channel-source-lane-prose.test.mjs` that reads Message/Mail channel source files and asserts lane wording replaces old Bee prose snippets.
- [x] Update the targeted source comments in Message and Mail channel modules while preserving compatibility symbols and storage keys.
- [x] Run verification gates: `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
