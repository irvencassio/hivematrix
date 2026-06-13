# Console Reply Draft Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Design Reference

- `docs/superpowers/specs/2026-06-13-console-reply-draft-preservation-design.md`

## Tasks

- [x] Add failing raw-console regression coverage in `src/daemon/console.test.ts`
  for draft-preservation hooks.
- [x] Edit `src/daemon/console.ts` so retry/reply textareas call
  `onCtxDraft(ctx, this)` on input.
- [x] Add local `_ctxDraft` state for `retry` and `reply`.
- [x] Add local active textarea/caret state for `retry` and `reply`.
- [x] In `selectTask()`, sync drafts before same-task `innerHTML` rebuilds and
  reset drafts/focus only when switching tasks.
- [x] Restore draft values and focus/caret after rebuilding the detail pane.
- [x] Clear the relevant draft only after successful retry/reply submission.
- [x] Run focused console tests.
- [x] Run `npm test`, `npm run typecheck`, and `node scripts/scope-wall.mjs`.

`npx tsx scripts/qwen-readiness.mts` is not required because this change does
not touch local-model paths.
