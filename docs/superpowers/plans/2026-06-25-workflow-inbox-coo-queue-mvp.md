# Workflow Inbox / COO Queue MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-workflow-inbox-coo-queue-mvp-design.md`. Builds on `f8ee425`.

## Task 1 — Shared action assessment [TDD]
- [x] RED: `actions.test.ts` — `assessWorkflowAction` returns ready/review_required/needs_input/completed agreeing with execute.
- [x] GREEN: extract `assessWorkflowAction` (pure, no dispatch); refactor `executeWorkflowAction` to use it.

## Task 2 — Inbox service [TDD]
- [x] RED: `src/lib/workflows/inbox.test.ts` — empty groups; needs_review run; blocked/ready/needs_input actions; attention groups; no secrets; deterministic.
- [x] GREEN: `src/lib/workflows/inbox.ts` — `getWorkflowInbox` + `InboxItem` + groups + counts; scrubbed titles/reasons.

## Task 3 — Endpoint + model tool [TDD]
- [x] RED: `lane-tools.coo.test.ts` (or inbox test) — `formatWorkflowInboxSummary` concise + secret-free; `workflow_inbox` registered.
- [x] GREEN: `GET /workflows/inbox`; `workflow_inbox` lane tool (coo_router) + `formatWorkflowInboxSummary`; update lane-tools catalog tests (count + mode lists).

## Task 4 — Briefing [TDD]
- [x] RED: `briefing.test.ts` — workflow inbox line (reviews / ready / failed, no previews).
- [x] GREEN: `workflowInbox` input + render in `buildVoiceBriefing`; wire `composeBriefing`.

## Task 5 — Console + cleanup + gates
- [x] Console "Workflow inbox" panel + source test (counts, ready Execute, blocked reason).
- [x] Tick checkboxes in `docs/superpowers/plans/2026-06-25-workflow-review-gate-mvp.md`.
- [x] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`, `npm run verify:portal` green. Commit + push to `main`.
