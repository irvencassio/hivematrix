# Landed Flight Delete Design

## Problem

A Flight can appear landed but still refuse deletion. The delete guard currently checks child item/task activity before considering whether the Flight itself is terminal. If a terminal Flight has stale item or linked task state, the API can return a running/active-task conflict even though the operator-facing Flight is already landed.

On iPhone, Flights can be opened and deleted from the detail screen, but landed Flights do not expose the expected native list affordance: swipe left to delete.

## Goals

- A landed/terminal Flight can be deleted from the daemon even if stale linked child state remains.
- Non-terminal Flights with running items or active linked tasks remain protected.
- iPhone Flight rows expose a trailing swipe delete action for landed Flights.
- Running/staged/review Flights do not get a destructive full-swipe list action.
- Keep linked board tasks as history; deleting a Flight only removes the Flight and its items.

## Proposed Design

### Daemon

`deleteWorkPackage()` should load the package status. If the package status is terminal (`done`, `done_with_skips`, `failed`, `cancelled`, or `archived`), delete it without applying child running-item or active-linked-task guards. Those guards still apply to non-terminal packages.

This matches operator intent: package status is the source of truth for whether the Flight is still active. Stale child state should not strand a landed Flight.

### iPhone

Add a model helper:

```swift
var isLanded: Bool { ["done", "done_with_skips", "archived"].contains(status) }
```

Use that helper on Flight rows in both the inline Board Flights section and the dedicated Flights sheet. For landed Flights, attach a trailing `.swipeActions` delete button. The action calls a shared `AppStore.deleteFlight(id:)` helper so both list surfaces remove the local row and refresh consistently.

Keep the existing detail-screen delete button for all Flights, because it can surface the server's reason when deletion is refused.

## Acceptance Criteria

- Deleting a `done` or `done_with_skips` Flight succeeds even if a linked child task is stale `in_progress`.
- Deleting a non-terminal Flight with running items or active linked tasks still returns a conflict.
- iPhone Board and Flights list rows include a swipe delete action only for landed Flights.
- Tests cover daemon delete behavior and iOS status/helper/source wiring.
- Required HiveMatrix gates pass: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.
- iOS build/test verification is run for the touched Swift code.
