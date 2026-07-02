# Flight Auto-Land Review Design

## Problem

Flights can show multiple `Accept / Land` buttons even when the linked child tasks already completed cleanly. The backend has auto-land logic for low-risk, blocker-free review items, but the periodic work-package tick only advances packages in `running`. Once a package rolls up to `review`, stale review items are not reconciled unless an operator presses `Accept / Land` or manually reconciles the Flight.

The board's bulk archive action also updates tasks directly. If it archives work-package child tasks while their items remain in `review`, the package can stay stale until a manual repair path runs.

## Goal

Make clean low-risk review work autonomous:

- Periodically reconcile packages in `review`, not only `running`.
- Keep manual `Accept / Land` only for cases that genuinely need operator judgment.
- Do not auto-land held, medium/high-risk, blocked, release-gated, or needs-input work.

## Approach

1. Extend `tickWorkPackages` to advance both `running` and `review` packages.
2. Preserve the existing `shouldAutoLand` guard as the source of truth for what can land automatically.
3. Update the Flight item action UI so clean low-risk review items show an auto-land pending note instead of `Accept / Land`.
4. Keep `Accept / Land` visible when `_computeReviewReasonJs` returns a manual-review reason.

## Verification

- Add a backend test that a `review` package with a clean linked review task auto-lands during `tickWorkPackages`.
- Add a console test that clean low-risk review items do not render the manual accept button.
- Run focused tests for `src/lib/work-packages/orchestrate.test.ts` and `src/daemon/console.test.ts`.
