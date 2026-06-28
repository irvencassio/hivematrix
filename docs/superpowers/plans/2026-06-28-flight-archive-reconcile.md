# Flight Archived Child Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Tasks

- [ ] Add a failing test in `src/lib/work-packages/orchestrate.test.ts` showing that a started Flight item whose linked task becomes `archived` reconciles to `done` and rolls the package to `done`.
- [ ] Update `src/lib/work-packages/orchestrate.ts` so `itemStatusForTask("archived")` returns `done`.
- [ ] Run the focused work-package orchestration test and then apply the fix to the currently stuck Flight through the public API.
