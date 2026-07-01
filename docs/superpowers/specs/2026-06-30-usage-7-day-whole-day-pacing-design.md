# Usage 7-Day Whole-Day Pacing Colors - Design

> Status: draft-for-approval
> Date: 2026-06-30
> Topic: Make the desktop Usage 7-day display color by whole cycle day, not static percent thresholds or fractional elapsed time.

## Prompt To Implement

Update the HiveMatrix desktop Usage area so every 7-day subscription window uses whole-day pacing for its green/yellow/red color. Follow `AGENTS.md`: do not write production code before a failing test, create an implementation plan in `docs/superpowers/plans/`, execute task-by-task, and verify with `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.

User intent:

The 7-day display should color based on what whole day of the 7-day cycle we are in. Keep days whole. If the reset text says `in 1d 5h`, treat that as 2 whole days left and therefore day 6 of the cycle: 5 whole days have gone by and the normal target is `5/7 = 71.4% used` or `2/7 = 28.6% left`. On that day, `63% used` / `37% left` is green because it is behind the allowed pace. Around `5.9/7 = 84.3% used` should be yellow/gold. At `6/7 = 85.7% used` or higher, including `6.1/7`, show red.

Scope:

- Primary surface: `src/daemon/console.ts` Usage section.
- Preserve the existing Usage section location above Models, `#usageSummary`, `#usageDetailsSec`, `#usage`, `#usagePill`, Claude and Codex cards, no-dollar-copy rule, and existing refresh behavior.
- Apply the new 7-day color rule consistently to Claude `sevenDay`, `sevenDayOpus`, `sevenDaySonnet`, and Codex `sevenDay`.
- Do not change 5-hour color behavior unless needed to avoid shared-helper breakage.
- Do not change `/usage` payload shape or subscription fetching.

Acceptance examples:

- 7-day window, reset in `1d 5h`, utilization `63`: green/ok.
- 7-day window, reset in `1d 5h`, utilization `84.3`: yellow/warn.
- 7-day window, reset in `1d 5h`, utilization `85.7`: red/hi.
- 7-day window, reset in `1d 5h`, utilization `87.1`: red/hi.
- 7-day window, reset in `6d something`, utilization `15`: red/hi because day 1 budget is only `1/7 = 14.3%`.
- 7-day window, reset in less than 1 day, utilization `82`: green/ok because the cycle is on day 7 and under `6/7 = 85.7%`.

## Current Code Findings

The relevant browser code lives inside the raw console template in `src/daemon/console.ts`.

- `fmtResets()` formats reset text as `in <d>d <h>h` or `in <h>h <m>m`.
- `usageBarClass(util, resetsAt, durationMs)` currently uses fractional elapsed time, burn ratios, and static floors (`>= 60`, `>= 80`, `>= 90`).
- `usageProviderCard()` uses `usageBarClass()` for the compact provider card.
- `renderSubBar()` uses `usageBarClass()` for Claude detailed rows, including `7-day overall`, `7-day Opus`, and `7-day Sonnet`.
- `renderCodexBar()` uses `usageBarClass()` for Codex detailed rows, including `7-day overall`.
- `checkUsage()` normalizes Claude and Codex windows and passes `durationMs: 604800000` for 7-day windows.
- `usageStatusDot` also computes its worst color by calling `usageBarClass()`.

There is also a TypeScript backend helper in `src/lib/usage/subscription.ts`:

- `classifyWindowStatus(win, windowDurationMs, nowMs?)` already classifies windows, but it currently uses fractional elapsed time and ratio thresholds too.
- Existing tests in `src/lib/usage/subscription.test.ts` encode the older fractional/ratio behavior, so implementation should update or replace those tests if this helper remains a source of truth.

Existing console tests in `src/daemon/console.test.ts` extract the raw browser script from `CONSOLE_HTML`, verify the Usage section, and guard no-dollar copy. This is the right place for RED tests against the rendered browser helper because the console script is not typechecked by TypeScript.

## Rule

For 7-day windows only:

```text
totalDays = 7
msPerDay = 24 * 60 * 60 * 1000
timeLeftMs = resetsAt - now
wholeDaysLeft = clamp(ceil(timeLeftMs / msPerDay), 0, 7)
wholeDaysElapsed = 7 - wholeDaysLeft

green ceiling = wholeDaysElapsed / 7
red floor = (wholeDaysElapsed + 1) / 7

green: usedFraction <= green ceiling
yellow: usedFraction > green ceiling and usedFraction < red floor
red: usedFraction >= red floor
```

Clamp comparisons to percent values:

```text
greenMaxPct = (wholeDaysElapsed / 7) * 100
redMinPct = ((wholeDaysElapsed + 1) / 7) * 100
```

Important boundary behavior:

- Use `Math.ceil()` for days left so partial remaining days count as a full remaining day.
- When `timeLeftMs <= 0`, fall back to the existing expired-window static behavior.
- Clamp days to `0..7` to handle clock skew or stale reset timestamps.
- Treat day 1 as `wholeDaysElapsed = 0` until fewer than 6 whole days remain. That means any usage above `1/7` should be red during the first day.
- For day 7, `wholeDaysElapsed = 6`, so usage below `6/7` is green, usage from `6/7` upward is red. There is effectively no yellow band past the last whole-day target.

## Design Options

### Option 1 - Update Browser Helper Only

Change `usageBarClass()` in `src/daemon/console.ts` to branch when `durationMs === 604800000` and apply whole-day pacing there. Keep `classifyWindowStatus()` unchanged.

Pros:

- Smallest implementation.
- Directly fixes the visible bug in the screenshot.

Cons:

- Leaves backend helper semantics different from UI semantics.
- Future code may call `classifyWindowStatus()` and reintroduce the old behavior.

### Option 2 - Update Both Helpers In Place

Update `usageBarClass()` and `classifyWindowStatus()` to share the same 7-day whole-day behavior, with tests in both `src/daemon/console.test.ts` and `src/lib/usage/subscription.test.ts`.

Pros:

- Keeps UI and backend helper aligned.
- Minimal file movement.
- Best fit for a small, TDD-driven change.

Cons:

- Still duplicates logic in raw browser JS and TypeScript.

### Option 3 - Extract Shared Pure Logic

Create a shared TS helper for 7-day pacing and arrange the console browser script to use an equivalent tested implementation.

Pros:

- Cleaner long-term boundary.

Cons:

- The console ships browser JS as a raw string, so true sharing is awkward.
- Larger refactor for a narrow color-rule fix.

## Recommendation

Use Option 2. It is the right balance for this change: fix the visible console behavior, keep the existing backend classifier aligned, avoid changing `/usage`, and keep implementation small enough for focused RED-GREEN-REFACTOR.

## Tests To Write First

In `src/daemon/console.test.ts`:

- Extract `usageBarClass()` from the console script with `new Function(...)`.
- Stub `Date.now()` or wrap the function body so tests can pass deterministic reset timestamps.
- Add RED tests for the exact acceptance examples:
  - reset in `1d 5h`, `63` returns `ok`;
  - reset in `1d 5h`, `84.3` returns `warn`;
  - reset in `1d 5h`, `85.7` returns `hi`;
  - reset in `1d 5h`, `87.1` returns `hi`;
  - reset in `6d 5h`, `15` returns `hi`;
  - reset in `12h`, `82` returns `ok`.
- Add a regression guard that 5-hour windows still use the existing non-7-day behavior.

In `src/lib/usage/subscription.test.ts`:

- Update `classifyWindowStatus()` tests to expect the new 7-day whole-day pacing.
- Keep expired-window fallback tests.
- Keep a 5-hour constant test so non-7-day behavior does not accidentally change.

## Implementation Notes

- Prefer a small helper such as `classifyWholeDaySevenDayUsage(util, resetsAt, nowMs)` in `src/lib/usage/subscription.ts`.
- Mirror the same small logic inside the browser `usageBarClass()` or add a nested local helper in the raw script.
- Map TypeScript colors to console classes:
  - `green` -> `ok`
  - `yellow` -> `warn`
  - `red` -> `hi`
- Do not base the 7-day color on raw `remaining <= 20`, `util >= 60`, `util >= 80`, or `util >= 90`; those static thresholds are the old behavior and contradict the day-paced rule.

## Verification

Run focused tests first:

```sh
node --import tsx/esm --test src/daemon/console.test.ts src/lib/usage/subscription.test.ts
```

Then run repo gates:

```sh
npm run typecheck
npm test
node scripts/scope-wall.mjs
```
