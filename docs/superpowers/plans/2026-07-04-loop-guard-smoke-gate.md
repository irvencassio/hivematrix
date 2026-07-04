# Loop Guard Smoke Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] RED: Update `src/lib/orchestrator/generic-agent.test.ts` with focused tests proving loop-guarded completion still requires smoke verification and exhausted smoke failures return exit code 1.
- [x] GREEN: Update `src/lib/orchestrator/generic-agent.ts` so `forceTextOnlyTurn` no longer bypasses completion smoke verification, failed smoke retries re-enable tools, and exhausted smoke failures return nonzero.
- [x] REFACTOR: Keep helper names narrow and comments aligned with the actual control flow.
- [x] Verify with focused tests, then `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
- [ ] Commit, push `main`, then run `npm run autodeploy` for the auto-update build pipeline.
