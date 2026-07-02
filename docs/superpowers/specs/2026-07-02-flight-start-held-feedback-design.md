# Flight Start Held Feedback Design

## Problem

A Flight can show `Start Flight` while all remaining work is held. Pressing it calls the backend, but no item starts because held items are intentionally gated. The console then reports a generic success state and does not render the blocker details, so the operator experiences the click as "nothing happened."

The live example is a Flight with four landed items and one held item. The backend can already classify the held blocker, but the start action does not surface it in the detail view.

## Goal

Make Start Flight honest and actionable:

- If Start cannot launch anything, show the same blocker explanation used by Advance.
- Do not silently unhold items that were intentionally held.
- Preserve the existing item-level `Ready` action as the explicit operator unblock.
- Avoid reintroducing a broad "run all" behavior.

## Approach

1. Keep backend held-item semantics unchanged.
2. Update the console `wpStart` path to use blocker-aware messaging when `started.length === 0`.
3. Refresh the selected Flight detail with returned `stall` / `blockers`, matching `wpAdvance`.
4. Ensure the blocker banner prioritizes concrete held/review/dependency/writer causes over the generic `noReadyItems` fallback.

## Verification

- Add source-level console tests for Start blocker rendering and messaging.
- Run the focused console test.
- Run `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
