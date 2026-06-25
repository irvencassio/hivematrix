# Content Research Brief Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-content-research-brief-workflow-design.md`. Builds on `01a5ac3`.

## Task 1 — Definition + registry [TDD]
- [ ] RED: extend `src/lib/workflows/registry.test.ts` — both workflows listed; match `content.research_brief` by phrase.
- [ ] GREEN: `src/lib/workflows/content-research-brief.ts` (def-only) + add to `BUILTIN_WORKFLOWS`.

## Task 2 — Prepare helper [TDD]
- [ ] RED: `src/lib/workflows/content-research.test.ts` — `buildResearchBriefMarkdown` deterministic + no secrets; `prepareContentResearchBrief` creates a run + briefMarkdown artifact (injected search), returns runId + markdown, redacted.
- [ ] GREEN: `src/lib/workflows/content-research.ts` — pure markdown builder + prepare helper (injected search/now).

## Task 3 — API + COO + console + runbook
- [ ] Extend `POST /workflows/:id/prepare` (branch on handler) for `content-research-brief`.
- [ ] COO test: `dispatchCooRequest` surfaces `content.research_brief` from "research brief" text.
- [ ] Console: "Prepare research brief" control (`prepareResearchBrief`) + source test update.
- [ ] `docs/runbooks/content-research-brief.md`.

## Task 4 — Cleanup + gates + push
- [ ] Tick checkboxes in `docs/superpowers/plans/2026-06-25-workflow-run-ledger-mvp.md`.
- [ ] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`, `npm run verify:portal` green. Commit + push to `main`.
