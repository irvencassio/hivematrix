# Local Agent Context Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] RED: Add `src/lib/orchestrator/tool-bridge.test.ts` coverage proving `read_file` refuses binary/image uploads, default reads are bounded, `search` excludes noisy generated/worktree folders, and `list_files` excludes the same folders.
- [x] RED: Add `src/lib/orchestrator/generic-agent.test.ts` coverage for a model-message tool-result cap with a truncation notice.
- [x] GREEN: Update `src/lib/orchestrator/tool-bridge.ts` with binary-safe reads, bounded file reads, `rg`/safe-exclude search, and safe-exclude file listing.
- [x] GREEN: Update `src/lib/orchestrator/generic-agent.ts` so tool results appended back to the model use the cap/truncation helper.
- [x] REFACTOR: Keep constants named for context hygiene and reuse one exclude list across search/listing.
- [x] Verify with focused tests, then `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`, and `npx tsx scripts/qwen-readiness.mts`.
