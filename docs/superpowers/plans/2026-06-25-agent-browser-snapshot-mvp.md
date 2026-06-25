# Agent-Browser Snapshot MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-agent-browser-snapshot-mvp-design.md`. Builds on `9df038b`.

## Task 1 — Snapshot extractor [TDD]
- [x] RED: `src/lib/browser-lane/adapters/agent-browser.test.ts` — `buildAgentBrowserSnapshot` for: plain page (title + text), login form (password → `unauthenticated`, `purpose:login`, labeled fields), link/button actions, password/token redaction, never `authenticated`.
- [x] GREEN: `buildAgentBrowserSnapshot(url, html)` in `src/lib/browser-lane/adapters/agent-browser.ts` (pure, deterministic, no deps; redaction).

## Task 2 — Real adapter [TDD]
- [x] RED: same test file — adapter `open`+`snapshot` with injected `fetchPage`; invalid URL → error; fetch failure → `ok:false`; default factory is not the unavailable stub.
- [x] GREEN: `createAgentBrowserAdapter({ fetchPage? })` — open/snapshot/act(read-only)/screenshot(unsupported)/close; default real `fetch` (no credentials).

## Task 3 — Readiness integration + probe-service [TDD]
- [x] RED: `probe-service.test.ts` — replace the "not wired yet" default test with a real-adapter (injected fetch) run → `ready` on matching text + `human_required` on a login page; `backendReady:true`. Keep the injected-fake test.
- [x] GREEN: `backendReady:true` in `probe-service.ts`; enrich the `probe.snapshot` trace with safe metadata (title, form/action counts) in `readiness.ts`.

## Task 4 — Cleanup + gates + push
- [x] Tick checkboxes in `docs/superpowers/plans/2026-06-25-browser-lane-readiness-maintenance.md`.
- [x] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs` green. Commit + push to `main`.
