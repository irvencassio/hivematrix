# Script Draft Workflow MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-script-draft-workflow-mvp-design.md`. Builds on `1472db1`.

## Task 1 — Definition + registry [TDD]
- [x] RED: extend `src/lib/workflows/registry.test.ts` — `content.video_script_from_brief` registered + matched by phrase.
- [x] GREEN: `src/lib/workflows/video-script-def.ts` (def-only) + add to `BUILTIN_WORKFLOWS`.

## Task 2 — Prepare helper [TDD]
- [x] RED: `src/lib/workflows/video-script.test.ts` — buildVideoScript* deterministic + scrubbed; prepare with briefMarkdown → run + scriptMarkdown artifact (needs_review) + HeyGen proposal w/ real script+title; with sourceRunId loads brief; neither → error; no secrets.
- [x] GREEN: `src/lib/workflows/video-script.ts` (pure builders + prepareVideoScriptFromBrief) + add `content-video-script` case to `prepare.ts`.

## Task 3 — Research brief handoff + chain [TDD]
- [x] RED: update `content-research.test.ts` — brief proposes `content.video_script_from_brief`; chain test (execute brief action → script run → script proposes HeyGen prepare-only, no Browser Lane task).
- [x] GREEN: `content-research.ts` proposes the script workflow.

## Task 4 — Console + cleanup + gates
- [x] Console "Prepare video script" control + source test.
- [x] Tick checkboxes in `docs/superpowers/plans/2026-06-25-workflow-action-handoff-mvp.md`.
- [x] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`, `npm run verify:portal` green. Commit + push to `main`.
