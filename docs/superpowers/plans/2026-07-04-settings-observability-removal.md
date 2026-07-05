# Settings Observability Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] RED: Update `src/daemon/console.test.ts` so Settings tab expectations exclude Observability and explicitly reject `tab-observability` / `settingsObservability`.
- [x] GREEN: Remove the Settings Observability tab, panel, and switch routing from `src/daemon/console.ts`.
- [x] REFACTOR: Keep the full Observability dashboard popup comments and modal-only window control accurate.
- [x] Verify with focused console tests and standard gates.
