# Fail-Closed Production DB Guard on Main — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-07-15-goals-data-loss-design.md`

## Context: why this plan exists separately from the design doc

The design doc above was written and its fix implemented inside an isolated
worktree (`.claude/worktrees/fix-goals-data-loss`, branch
`fix/goals-data-loss-db-test-isolation`), which was left **uncommitted and
never merged to `main`**. This plan re-verifies and lands the one part of
that worktree's work that is not duplicated anywhere else, directly on
`main`.

**Explicitly excluded from this port** — the worktree's
`src/lib/goals/import-from-persona.ts` (a GOALS.md → `goals` table seeder)
and its `src/daemon/index.ts` startup wiring. That work is now redundant:
`main` shipped an equivalent, better-built fix independently as commit
`e6e41b25` (`src/lib/goals/persona-seed.ts`), which reuses the existing
`parseSectionBullets` parser from `@/lib/brain/persona-section` instead of a
from-scratch bullet parser. `e6e41b25` already solves the "Goals panel empty
after wipe" symptom on `main`. Porting the worktree's parallel implementation
on top of it would just be a second, competing goals-importer — a new
concept the Complexity Budget in AGENTS.md explicitly asks us not to add
when an existing one already covers it.

**What this plan lands** — the design doc's §2.1/§3 item 1: a fail-closed
guard in `resolveDbPath()` (`src/lib/db/index.ts`) so that no future test
file, however it's written, can silently fall through to opening the real
`~/.hivematrix/hivematrix.db` under `NODE_ENV=test`. This is the actual
root-cause fix for the 2026-07-14 data-loss incident (the importer only
treats the symptom that incident happened to surface — the empty Goals
panel — not the mechanism that caused it). Nothing on `main` had this guard
before this change.

## Task 1 — Add the guard, prove RED→GREEN, re-verify `npm test` end to end

Files:
- Edit: `src/lib/db/index.ts` (`resolveDbPath()`)
- Edit: `package.json` (`test`, `test:watch` scripts)
- New: `src/lib/db/resolve-db-path.test.ts`
- Edit: `src/daemon/server.test.ts` (isolation gap #1)
- Edit: `src/lib/orchestrator/codex-agent.test.ts` (isolation gap #2)
- Edit: `src/lib/messagebee/status.test.ts` (isolation gap #3 — new, found on `main`, not present in the worktree)

### Reused (do not reimplement)

- `_resetDbForTests` from `@/lib/db` — existing test-only singleton reset.
- The two already-established isolation conventions already used across the
  suite: a temp-dir `HIVEMATRIX_DB_PATH` override (`src/lib/messagebee/store.test.ts`),
  or a temp-dir `HOME` override (`withTempHome(t)` helper already defined in
  `src/daemon/server.test.ts`).

- [x] **Red:** Wrote `src/lib/db/resolve-db-path.test.ts` (copied verbatim
  from the worktree — two tests: guard throws when nothing isolates the DB
  under `NODE_ENV=test`; guard stays out of the way when `HIVEMATRIX_DB_PATH`
  is set). Ran standalone: `npx tsx --test src/lib/db/resolve-db-path.test.ts`
  → 1 pass / **1 fail** (`Missing expected exception` — confirms `main`'s
  `resolveDbPath()` had no guard yet).

- [x] **Green:** Replaced `resolveDbPath()` in `src/lib/db/index.ts` with the
  fail-closed version: computes `path` first, and if `NODE_ENV === "test"`
  and `path === process.env.HIVEMATRIX_PROD_DB_GUARD`, throws instead of
  `mkdirSync`-ing and returning it. Updated `package.json`'s `test` and
  `test:watch` scripts to export `HIVEMATRIX_PROD_DB_GUARD="$HOME/.hivematrix/hivematrix.db"`
  from the invoking shell before `node` starts (so a test overriding
  `process.env.HOME` later can't defeat the comparison — an overridden HOME
  changes `path` itself, which naturally no longer matches the guard).
  Re-ran the same standalone command → 2 pass / 0 fail.

- [x] **Full-suite sweep:** Ran `npm test` (now exercising the guard across
  every test file). This is the step the design doc's own §2.1 flags as
  necessary and incomplete-by-nature — `main` is ~15 commits ahead of the
  worktree's branch point, so files added or changed since then hadn't been
  checked against the guard. Found **one test-isolation gap beyond the two
  the worktree already knew about**:

  - `src/lib/messagebee/status.test.ts` — `getMessagebeeStatus({ probe: true })`
    transitively reaches `isChannelEnabled()` → `getDb()` with no isolation
    at all. Not present in the worktree (this file didn't exist at its
    branch point) — a gap introduced by a commit made after the worktree
    branched, exactly the kind of "next file someone adds" scenario the
    fail-closed guard exists to catch. Fixed the same way as `store.test.ts`
    in the same directory: module-scope
    temp `HIVEMATRIX_DB_PATH`, `test.after` cleanup via `_resetDbForTests()`.

  The two gaps the worktree already found and fixed were re-verified against
  `main`'s **current** versions of those files (which have diverged from the
  worktree's branch point with unrelated new tests — new voice/turn,
  capabilities, and messagebee reveal/restart-daemon tests were added to
  `server.test.ts` since then) and fixed the same way, adapted to current
  content:
  - `src/daemon/server.test.ts` — the `POST /onboarding/setup/desktop-permissions/request`
    test reaches `buildFirstRunSetupResponse()` → `getMessagebeeStatus()`/
    `getMailbeeStatus()` → `getDb()`. Fixed by calling the file's own
    `withTempHome(t)` helper (already used by ~30 other tests in this file)
    as the first line of the test — not the worktree's original manual
    `mkdtempSync`/`process.env.HOME` boilerplate, since `main` has since
    consolidated that exact boilerplate into the shared helper and AGENTS.md's
    Complexity Budget says to reuse shared scaffolding rather than re-roll it.
  - `src/lib/orchestrator/codex-agent.test.ts` — every test calls
    `buildCodexPrompt()`, which reaches `isChannelEnabled()` for both mail and
    message lanes. This file is otherwise unchanged from the worktree's branch
    point, so the worktree's fix (module-scope temp `HOME` override + one
    `test.after` cleanup) was copied over verbatim.

  Re-ran `npm test` after all three fixes: **3016 tests, 3015 pass, 0 fail, 1
  skipped** (the one skip is pre-existing and unrelated — present in the
  pre-fix run too).

- [x] **Verification gates** (AGENTS.md):
  - `npm run typecheck` → zero errors.
  - `node scripts/scope-wall.mjs` → `Result: 0 violation(s), 0 warning(s)`.
    No DECISIONS.md entry needed: this adds a guard clause to an existing
    chokepoint (`resolveDbPath()`), not a new persistent store or concept.

## Out of scope (unchanged from the design doc's own §4, plus this session's addition)

- Everything in the design doc's own §4 (restoring wiped historical rows,
  GOALS.md dedup, updater-level self-check) — untouched, operator's call.
- The GOALS.md → `goals` table importer (`import-from-persona.ts` in the
  worktree) — superseded by `e6e41b25`'s `persona-seed.ts`, not ported.
- The worktree itself (`.claude/worktrees/fix-goals-data-loss`) is left
  exactly as-is; its disposition (delete vs. keep for reference) is an
  operator decision, not made here.
