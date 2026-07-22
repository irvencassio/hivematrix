# Usage Pill Ticked Bars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-07-22-usage-pill-ticked-bars-design.md`.
All edits are in `src/daemon/console.ts` (HTML+CSS+JS template) and its test
`src/daemon/console.test.ts`. RED (update tests) → GREEN (implement) → verify.

## Task 1 — Tests encode the new geometry + fill (RED)

- [ ] In `console.test.ts`, test "header Usage section is removed…" (~L1911): replace
  the 7-day tick-count assertions (`class="usage-bar-day"` × 7) with:
  - `id="usageBar7dFill"` present (7d now a fill bar, not day-boxes);
  - `usage-bar-day` no longer appears in the header zone;
  - the 7d `.usage-bar` contains 6 `usage-bar-tick` spans; 5h contains 4; ctx contains 3.
- [ ] Rewrite harness `consoleUsageBars()` (~L1955): drop `makeTick`/`ticks`/`usageBar7d`;
  add `usageBar7dFill: { style: { width: "" }, className: "" }` to `els`; return no `ticks`.
- [ ] Rewrite "7-day toggle button fills ticks up to the current cycle day…" (~L2033):
  seed `{remaining:72, utilization:28, reset:+5d5h}` → assert `usageBar7dFill.style.width === "28.57%"`,
  `className === "usage-bar-fill ok"`, title `"Day 2 of 7 · 72% left · resets in 5d 5h"`.
- [ ] Rewrite "7-day ticks turn red…" (~L2054): seed `{remaining:71, utilization:29, reset:+5d5h}`
  → width `"28.57%"`, `className` contains `" hi"` (2 days-worth, over pace).
- [ ] Rewrite "7-day ticks clear when there is no 7-day window…" (~L2074): assert
  `usageBar7dFill.style.width === "0%"`, `className === "usage-bar-fill"`, title `""`.
- [ ] Add a case proving usage-worth ≠ elapsed days: seed `{remaining:62, utilization:38,
  reset:+18h29m}` (day 7) → width `"42.86%"` (3 bars), `className` contains `" ok"`.

## Task 2 — Geometry: markup + CSS (GREEN)

- [ ] 5h button markup: inside `<span class="usage-bar" id="usageBar5h">`, after the fill,
  add 4 ticks at `left:20/40/60/80%`.
- [ ] 7d button markup: replace the `usage-bar-days`/`usage-bar-day`×7 block with
  `<span class="usage-bar" id="usageBar7d"><span class="usage-bar-fill" id="usageBar7dFill"></span>`
  + 6 ticks at `left:14.29/28.57/42.86/57.14/71.43/85.71%`.
- [ ] ctx markup: inside its `<span class="usage-bar">`, after the fill, add 3 ticks at `left:25/50/75%`.
- [ ] CSS: `.usage-win-bars .usage-bar` and `.ctx-meter .usage-bar` width `44px → 76px`.
- [ ] CSS: delete the now-unused `.usage-bar-days` and `.usage-bar-day*` rules; refresh the
  adjacent comment to describe the ticked-fill bar.

## Task 3 — 7d fill/pace logic (GREEN)

- [ ] Rewrite `renderUsage7dBar()`: resolve `usageBar7dFill`; on no window → width `0%`,
  class `usage-bar-fill`, title `""`. Else `usedPct = 100 - clamp(remaining,0,100)`,
  `filledBars = clamp(round(usedPct/(100/7)),0,7)`, width `(filledBars/7*100).toFixed(2)+"%"`,
  class `"usage-bar-fill " + usageBarClass(util, resetsAt, durationMs)`, preserve the exact
  `"Day N of 7 · X% left · resets …"` tooltip. Leave `usageBarClass` and `sevenDayCycleDay` unchanged.

## Task 4 — Verify

- [ ] `npm run typecheck` → 0 errors.
- [ ] `npm test` → all pass (esp. the usage-bar suite).
- [ ] `node scripts/scope-wall.mjs` → 0 violations.
- [ ] Independent code + spec-compliance review of the diff.
