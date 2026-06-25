# HeyGen Portal Pipeline Verification + Runbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-heygen-portal-pipeline-verification-design.md`. Builds on `59a5c7e`.

## Task 1 — Dry-run harness lib [TDD]
- [x] RED: `src/lib/video/verify-portal-pipeline.test.ts` (HOME+DB isolated) — all 8 phases pass; `evidence.publishArgs` has `publish.mjs`, not `make-avatar.mjs`; broken `serverSource` → `ok:false` with a clear endpoint-wiring failure; no secrets.
- [x] GREEN: `src/lib/video/verify-portal-pipeline.ts` — `runHeyGenPortalDryRun(deps?)` over the real helpers with injected fakes; typed `PortalDryRunReport`.

## Task 2 — CLI + npm script
- [x] `scripts/verify-heygen-portal-pipeline.mjs` (temp HOME + temp DB, prints phases, exits 0/1) + `npm run verify:portal`.

## Task 3 — Runbook + console link + cleanup + gates
- [x] `docs/runbooks/heygen-portal-video-pipeline.md` (prereqs, readiness, create, complete, publish, needs_publish_input, troubleshooting; Lane naming; no secrets).
- [x] HeyGen portal panel: muted one-line runbook pointer in `src/daemon/console.ts`.
- [x] Tick checkboxes in `docs/superpowers/plans/2026-06-25-heygen-portal-operator-controls.md`.
- [x] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`, `npm run verify:portal` green. Commit + push to `main`.
