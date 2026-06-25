# Market Insight Lane Prose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Tasks

- [x] Add a failing regression test in `scripts/market-insight-lane-prose.test.mjs` that checks market-data comments use Market Insight Lane wording while preserving compatibility contracts.
- [x] Update targeted source comments in the market-data modules and daemon route comments.
- [x] Run verification gates: `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
