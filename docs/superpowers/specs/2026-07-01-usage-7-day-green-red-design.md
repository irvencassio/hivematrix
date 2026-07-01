# Usage 7-Day Green Red Colors - Design

> Status: draft-for-approval
> Date: 2026-07-01
> Topic: Remove warning/amber color from 7-day subscription usage bars.

## Prompt To Implement

Update the HiveMatrix desktop Usage area so 7-day subscription windows are only
green or red. The color should be based on the whole day of the 7-day cycle and
remaining daily budget, not raw percent-left warning thresholds.

User intent:

- On day 7 of a Claude/Codex 7-day window, `31% left` means `69% used`, which is
  still below the day-7 red floor of `6/7 = 85.7% used`. It should be green, not
  warning/amber.
- Day-paced red floors:
  - day 1: red if usage is above `1/7 = 14.3% used`, equivalent to less than
    `85.7% left`;
  - day 2: red if usage is above `2/7 = 28.6% used`, equivalent to less than
    `71.4% left`;
  - continue by one-seventh per day;
  - day 7: still use the day-6 allowance, so `6/7 = 85.7% used` or `14.3% left`
    is okay/green; only worse than that is red.
- There is no 7-day warning/amber state. A 7-day window is either acceptable for
  the current day (`green` / `ok`) or over the daily pace (`red` / `hi`).

## Scope

- Primary surface: `src/daemon/console.ts` Usage section.
- Apply to every 7-day subscription window:
  - Claude `sevenDay`;
  - Claude `sevenDayOpus`;
  - Claude `sevenDaySonnet`;
  - Codex `sevenDay`.
- Keep 5-hour behavior unchanged.
- Keep `/usage` payload shape, reset formatting, subscription fetching, refresh
  behavior, and no-dollar-copy rule unchanged.
- Align backend helper semantics in `src/lib/usage/subscription.ts` so future
  usage of `classifyWindowStatus()` does not disagree with the UI.

## Current Code Findings

- `src/daemon/console.ts` has browser-side `usageBarClass(util, resetsAt,
  durationMs)`.
- `usageProviderCard()`, `renderSubBar()`, `renderCodexBar()`, and the
  `usageStatusDot` all call `usageBarClass()`.
- `checkUsage()` already passes `durationMs: 604800000` for Claude and Codex
  7-day windows.
- `src/lib/usage/subscription.ts` has `classifyWindowStatus()` with the older
  ratio/static-floor behavior.
- `docs/superpowers/specs/2026-06-30-usage-7-day-whole-day-pacing-design.md`
  introduced whole-day pacing with a yellow band. This document supersedes that
  part: 7-day windows must not return `warn` / `yellow`.

## Rule

For live 7-day windows only:

```text
totalDays = 7
msPerDay = 24 * 60 * 60 * 1000
timeLeftMs = resetsAt - now
wholeDaysLeft = clamp(ceil(timeLeftMs / msPerDay), 1, 7)
cycleDay = 8 - wholeDaysLeft
allowedDays = min(cycleDay, 6)

redFloorUsedPct = roundToOneDecimal((allowedDays / 7) * 100)
green if utilization <= redFloorUsedPct
red if utilization > redFloorUsedPct
```

Boundary examples:

- reset in `6d ...` means day 1; `15% used` is red.
- reset in `5d ...` means day 2; `28% used` and `28.6% used` are green, `29%`
  used is red.
- reset in less than `1d` means day 7; `69% used` / `31% left` is green,
  `85.7% used` / `14.3% left` is green, and `86% used` is red.

Use the one-decimal threshold that the UI communicates (`14.3`, `28.6`, ...),
so values displayed as exactly on the allowance line do not turn red because of
hidden floating-point precision.

For expired/stale windows or non-7-day windows, preserve existing behavior.

## Design Options

### Option 1 - Update Browser Helper Only

Change only `usageBarClass()` in `src/daemon/console.ts`.

Pros:

- Smallest visible fix.

Cons:

- Leaves `classifyWindowStatus()` with old yellow-capable semantics.
- Future call sites could reintroduce inconsistent status colors.

### Option 2 - Update Browser And Backend Classifiers

Update `usageBarClass()` and `classifyWindowStatus()` with the same 7-day
green/red rule, plus focused tests in `src/daemon/console.test.ts` and
`src/lib/usage/subscription.test.ts`.

Pros:

- Keeps visible UI and backend helper aligned.
- Small, testable, and preserves existing payloads.
- Best match for this behavior-only change.

Cons:

- Still mirrors logic once because the console browser script is embedded raw JS.

### Option 3 - Extract Shared Logic

Create a shared pure helper and restructure the console script around it.

Pros:

- Cleaner single source of truth.

Cons:

- Larger refactor than this color fix needs.
- The raw browser script boundary makes true sharing awkward.

## Recommendation

Use Option 2.

## Tests To Write First

In `src/daemon/console.test.ts`:

- Add a deterministic test harness for `usageBarClass()`.
- Assert 7-day windows return only `ok` or `hi`:
  - day 7, `69% used` returns `ok`;
  - day 7, `85.7% used` returns `ok`;
  - day 7, `86% used` returns `hi`;
  - day 1, `14% used` returns `ok`;
  - day 1, `15% used` returns `hi`;
  - day 2, `28% used` returns `ok`;
  - day 2, `28.6% used` returns `ok`;
  - day 2, `29% used` returns `hi`.
- Keep a 5-hour regression guard showing `warn` can still exist for non-7-day
  windows.

In `src/lib/usage/subscription.test.ts`:

- Update 7-day classifier expectations to the same green/red-only day-paced
  behavior.
- Keep expired-window fallback tests.
- Keep a five-hour regression guard.

## Verification

Focused tests:

```sh
node --import tsx/esm --test src/daemon/console.test.ts src/lib/usage/subscription.test.ts
```

Repo gates:

```sh
npm run typecheck
npm test
node scripts/scope-wall.mjs
```
