# Usage 7-Day Green Red Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-07-01-usage-7-day-green-red-design.md`

- [x] RED: Add deterministic `usageBarClass()` coverage in `src/daemon/console.test.ts` proving 7-day bars are green/red only by current cycle day.
  - Day 7, reset in `18h 29m`, `69% used` returns `ok`.
  - Day 7, `85.7% used` returns `ok`.
  - Day 7, `86% used` returns `hi`.
  - Day 1, `14% used` returns `ok`; `15% used` returns `hi`.
  - Day 2, `28.6% used` returns `ok`; `29% used` returns `hi`.
  - A 5-hour window can still return `warn`.
  - Run first: `node --import tsx/esm --test src/daemon/console.test.ts`.

- [x] RED: Update `src/lib/usage/subscription.test.ts` classifier expectations for the same 7-day green/red-only rule.
  - Cover day 7 `69`, `85.7`, and `86`.
  - Cover day 1 `14` and `15`.
  - Cover day 2 `28.6` and `29`.
  - Preserve expired-window fallback and five-hour behavior.
  - Run first: `node --import tsx/esm --test src/lib/usage/subscription.test.ts`.

- [x] GREEN: Update `src/daemon/console.ts`.
  - In `usageBarClass(util, resetsAt, durationMs)`, branch only for live 7-day windows.
  - Compute `wholeDaysLeft = clamp(ceil(timeUntilResetMs / dayMs), 1, 7)`.
  - Compute `cycleDay = 8 - wholeDaysLeft`, `allowedDays = min(cycleDay, 6)`, and `redFloorUsedPct = roundToOneDecimal(allowedDays * 100 / 7)`.
  - Return `ok` when `util <= redFloorUsedPct`, otherwise `hi`.
  - Leave non-7-day and expired-window behavior unchanged.

- [x] GREEN: Update `src/lib/usage/subscription.ts`.
  - Add or inline the same live 7-day classifier.
  - Return `green` when utilization is within the current day allowance, otherwise `red`.
  - Leave non-7-day and expired-window behavior unchanged.

- [x] REFACTOR/VERIFY: Run focused tests:
  - `node --import tsx/esm --test src/daemon/console.test.ts src/lib/usage/subscription.test.ts`

- [x] FINAL GATES: Run:
  - `npm run typecheck`
  - `npm test`
  - `node scripts/scope-wall.mjs`

- [ ] RELEASE: Commit all intended changes, push `main`, run the supported HiveMatrix autodeploy lane, and prove the live auto-update feed with `npm run release:verify`.
