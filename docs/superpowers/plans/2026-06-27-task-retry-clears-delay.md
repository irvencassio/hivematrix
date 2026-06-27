# Task Retry Clears Delay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [ ] Add a failing assertion in `src/daemon/console.test.ts` proving the retry route clears `delayUntil` and `delayReason`.
- [ ] Update `src/daemon/server.ts` so `POST /tasks/:id/retry` includes `delayUntil: null` and `delayReason: null` in its reset fields.
- [ ] Run the focused daemon test file, then typecheck if the focused test passes.
