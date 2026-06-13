# Frontier Usage Bars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Add a Codex usage reader seam and `codexSubscription` field in `src/lib/usage/frontier-usage.ts`.
- [x] Add `src/lib/usage/frontier-usage.test.ts` coverage for Codex subscription data.
- [x] Update `src/daemon/console.ts` to render a Codex subscription section with progress bars.
- [x] Extend `src/daemon/console.test.ts` string guards for the Codex usage section.
- [x] Run focused usage/console tests, then full verification gates.
