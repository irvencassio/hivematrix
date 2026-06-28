# Bundled Python Absolute Symlinks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-28-bundled-python-absolute-symlinks-design.md`

- [ ] RED: Add `scripts/build-daemon-python-symlinks.test.mjs` requiring `scripts/build-daemon.mjs` to replace absolute symlinks under the staged Python runtime.
- [ ] GREEN: Update `scripts/build-daemon.mjs` with a recursive helper that replaces absolute symlinks with real target copies and call it after staging Python.
- [ ] VERIFY: Run the focused test, `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
