# Message Lane Disallow Controls Design

## Problem

Message Lane setup can add allowlisted senders and agent self-identities, but the current modal does not make all identity state editable in one place. Operators need to remove previously added agent identities, remove allowlist entries, and permanently disallow a sender that texted the agent without allowlisting them.

The existing data model already has `message_identities.status = blocked`, but blocked senders are not surfaced in setup and the inbound poller can still record them in the "Texted but not allowlisted" prompt list.

## Design

Keep identity management inside the existing Message Lane setup modal:

- Allowed senders continue to render as removable chips. Removing one sets it back to `pending`.
- Agent identities continue to render as removable chips. Removing one updates `selfHandles`.
- Ignored senders gain a `Disallow` action next to `Allow`.
- Disallowed senders render in a separate editable chip list. Each blocked chip can be changed to `Allow` or `Unblock`.

Backend behavior:

- Add `isBlocked(handle)` next to `isAllowed(handle)`.
- The poller must not call `recordIgnoredSender` for blocked handles.
- Posting an identity with status `allowed` or `blocked` clears the sender from the ignored prompt list.

## Verification

Use targeted tests first for the console source, store identity matching, and poller block suppression, then run the repo gates:

- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`
