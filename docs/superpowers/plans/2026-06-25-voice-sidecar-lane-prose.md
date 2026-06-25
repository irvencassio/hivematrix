# Voice Sidecar Lane Prose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Tasks

- [x] Add a failing regression test in `scripts/voice-sidecar-lane-prose.test.mjs` that reads the daemon route comment and voice sidecar source.
- [x] Update the targeted comments to use Voice Lane and Mail Lane prose.
- [x] Run verification gates: `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
