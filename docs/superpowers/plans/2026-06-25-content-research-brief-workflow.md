# Content Research Brief Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-content-research-brief-workflow-design.md`. Builds on `01a5ac3`.

## Task 1 — Definition + registry [TDD]
- [x] RED: extend `src/lib/workflows/registry.test.ts` — both workflows listed; match `content.research_brief` by phrase.
- [x] GREEN: `src/lib/workflows/content-research-brief.ts` (def-only) + add to `BUILTIN_WORKFLOWS`.

## Task 2 — Prepare helper [TDD]
- [x] RED: `src/lib/workflows/content-research.test.ts` — `buildResearchBriefMarkdown` deterministic + no secrets; `prepareContentResearchBrief` creates a run + briefMarkdown artifact (injected search), returns runId + markdown, redacted.
- [x] GREEN: `src/lib/workflows/content-research.ts` — pure markdown builder + prepare helper (injected search/now).

## Task 3 — API + COO + console + runbook
- [x] Extend `POST /workflows/:id/prepare` (branch on handler) for `content-research-brief`.
- [x] COO test: `dispatchCooRequest` surfaces `content.research_brief` from "research brief" text.
- [x] Console: "Prepare research brief" control (`prepareResearchBrief`) + source test update.
- [x] `docs/runbooks/content-research-brief.md`.

## Task 4 — Cleanup + gates + push
- [x] Tick checkboxes in `docs/superpowers/plans/2026-06-25-workflow-run-ledger-mvp.md`.
- [x] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`, `npm run verify:portal` green. Commit + push to `main`.
