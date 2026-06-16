# Command Run Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Add failing console tests proving the Commands panel owns `commandPath` and `runCommand()` does not read `t_path`.
- [x] Add the Commands project selector and `commandPath` input in `src/daemon/console.ts`.
- [x] Populate the Commands project selector from `loadProjects()` and sync it with the header project selector.
- [x] Update `runCommand()` to send `commandPath`, defaulting to `$HOME` when blank.
- [x] Run focused tests, then full verification gates before release.
