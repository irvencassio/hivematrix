# Desktop And Terminal Lane Prose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Tasks

- [x] Add a failing regression test in `scripts/desktop-terminal-lane-prose.test.mjs` that reads Desktop/Terminal source files plus the security review and asserts lane wording replaces old Bee prose snippets.
- [x] Update targeted prose/comments for Desktop Lane and Terminal Lane while preserving compatibility symbols, filenames, routes, and token names.
- [x] Run verification gates: `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
