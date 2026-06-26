# Settings Toggle Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [ ] Add failing console tests in `src/daemon/console.test.ts` for a dedicated settings switch component, readable `Enabled`/`Off` labels, `role="switch"`, and no `.reply-toggle` inside `renderFeatures`.
- [ ] Add `.settings-switch` CSS in `src/daemon/console.ts`, with visible on/off/disabled states across themes.
- [ ] Add a shared `settingsSwitch(...)` renderer helper and use it for feature flags, voice auto-approval, and morning briefing.
- [ ] Run focused console tests, full typecheck, full test suite, and scope-wall.
- [ ] Commit and push to `main`.
