# Message Lane Self Handles Setup Design

## Context

Message Lane already stores `metadata.selfHandles` and exposes `POST /messagebee/self-handles`, but the setup modal only exposes allowlisted senders. That hides the loop-guard identity list from the operator and makes it easy to accidentally classify the operator phone as a self-handle.

## Goal

Expose Message Lane self handles directly in the setup modal so the operator can set the agent's own iMessage identities separately from trusted senders.

## Chosen Approach

Add a compact "Agent identities" section to the existing Message Lane setup modal. It reads `selfHandles` from `GET /messagebee`, renders chips, accepts comma-separated phone/email entries, and saves them through the existing `/messagebee/self-handles` route before the normal enable/allowlist action.

## Alternatives Considered

1. Add this only to the Safe Senders settings panel. This would help advanced setup but keep the first-run modal incomplete.
2. Add a backend auto-detection pass from Messages accounts. This is useful later, but the current AppleScript account id does not reliably expose the human-readable sender email/phone.
3. Direct DB editing from setup. Rejected because the route already provides a tested API boundary.

## Acceptance Criteria

- The Message Lane modal includes a visible self-handle input and current self-handle chips.
- Saving the modal sends self handles to `/messagebee/self-handles`.
- The existing allowlist and enable flow still works.
- A focused console test catches removal of the UI/API wiring.
