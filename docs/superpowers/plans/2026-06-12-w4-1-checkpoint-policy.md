# W4.1 Strategy / Checkpoint Policy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Context

Final W4.1 hardening slice. Phase 3 (failure-context replan, `0101905`) is shipped. The
`approvalPolicy` directive column is inert; this slice parses and enforces an explicit
checkpoint policy (`none` / `plan` / `full`) that pauses the directive run for founder
approval, escalated via the W1.3 notify plane and the existing file-based approval store.

See `docs/superpowers/specs/2026-06-12-w4-1-checkpoint-policy-design.md`.

## Constraints

- Directives stay the only autonomy primitive; no new run phase or table.
- `none` (default) directives are unchanged — all existing tests must stay green.
- Fail closed: failed/denied/timed-out checkpoints must not silently proceed.
- Reuse the existing approval store + notify escalation; add no second approval path.
- TDD: failing test first, then minimal production code.

## Tasks

- [ ] Add `parseDirectiveCheckpointPolicy` to `directive-autonomy.ts` + unit tests
  (string form, nested form, default none, unknown → none).

- [ ] Add checkpoint request/read helpers to `approval.ts`
  (`requestCheckpointApproval`, `readCheckpointDecision`) reusing the existing file
  protocol; focused round-trip test under a temp HOME.

- [ ] Add failing engine tests in `directive-engine.test.ts`:
  - plan gate holds then approves (deterministic phases, `checkpoint: "plan"`);
  - plan gate rejects → run failed `checkpoint_rejected`, no execution tasks;
  - `none` bypasses the gate even with a reject-returning resolver;
  - `full` completion gate holds then approves (criteria proven only after approve);
  - `full` completion gate reject → run failed, criteria not proven.

- [ ] Implement in `directive-engine.ts`:
  - `_setDirectiveCheckpointResolverForTests`, `resolveCheckpoint`, production store path;
  - `checkpointLevel`, `journalCheckpointOnce`, plan-gate + completion-gate helpers;
  - wire plan gate into all three `planRun` plan paths;
  - wire completion gate into all three `verify → reflect` transitions (move production
    reviewer consume into the terminal branches so `hold` does not consume it).

- [ ] Update continuity docs + commercial workplan; reset the new test injector in the
  test before/after hooks.

- [ ] Verification gates: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`,
  `git diff --check`. Commit and push only this slice's files plus the brain/workplan docs.
