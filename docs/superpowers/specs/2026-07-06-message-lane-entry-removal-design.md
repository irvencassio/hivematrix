# Message Lane Entry Removal Design

## Context

The Message Lane setup modal lets the operator add allowlisted sender identities and agent self-handle identities, but the existing chips in that modal were read-only. Removal was only discoverable elsewhere in Settings for safe senders, and self-handle removal had no obvious modal control.

## Goal

Make existing Message Lane setup entries removable from the same modal where they are displayed:

- Allowlisted sender chips expose a remove control.
- Agent identity chips expose a remove control.
- Removing an allowlisted sender preserves the identity record but moves it to `pending`.
- Removing an agent identity rewrites the self-handle list without that entry.

## Approach

Reuse existing APIs instead of adding a server route:

- `POST /messagebee/identities` with `{ address, status: "pending" }` removes an allowed sender from the active allowlist.
- `POST /messagebee/self-handles` with the remaining handles replaces the self-handle set.
- Refresh the modal state after each change so the checkmarks and chips stay accurate.

## Verification

Run:

- `node --import tsx/esm --test src/daemon/console.test.ts`
- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`
