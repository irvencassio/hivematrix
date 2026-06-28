# One Command Autodeploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-28-one-command-autodeploy-design.md`

- [x] RED: Add `scripts/autodeploy-main.test.mjs` asserting the wrapper script, npm command, README command, version increment logic, release delegation, and release/notary/Node-RED source reporting exist.
- [x] GREEN: Add `scripts/autodeploy-main.sh` with one repeatable release wrapper that computes the next patch version and calls `node scripts/release.mjs <version> <note>`.
- [x] GREEN: Add `autodeploy` to `package.json` scripts and document it in the README command list.
- [x] VERIFY: Run `node --import tsx/esm --test scripts/autodeploy-main.test.mjs`, `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
