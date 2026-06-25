# Channel Source Lane Prose Design

## Context

HiveMatrix channel workers still use compatibility module paths and storage keys such as `messagebee` and `mailbee`, but the prose in source comments should explain the current lane strategy. This keeps agents and future maintainers from learning the old Bee naming from comments while avoiding a risky storage/API rename.

## Approved Direction

Continue the Bee-to-lane migration for explanatory code prose:

- `Message Lane` for SMS/iMessage ingestion, routing, sending, allowlists, and task replies.
- `Mail Lane` for Apple Mail ingestion, trust classification, drafting, sending, and delivery guards.
- Compatibility names remain in exported identifiers, test names, source values, task output keys, event names, and filesystem paths.

## Scope

Update prose/comments in:

- `src/lib/messagebee/store.ts`
- `src/lib/messagebee/handoff.ts`
- `src/lib/messagebee/imessage.ts`
- `src/lib/messagebee/poller.ts`
- `src/lib/messagebee/contracts.ts`
- `src/lib/messagebee/imessage.test.ts`
- `src/lib/mailbee/store.ts`
- `src/lib/mailbee/delivery.ts`
- `src/lib/mailbee/applemail.ts`
- `src/lib/mailbee/contracts.ts`
- `src/lib/mailbee/poller.ts`

Add a focused regression test that checks the source comments use lane wording and no longer contain the old descriptive snippets.

## Non-Goals

- Do not rename exported TypeScript types/functions.
- Do not rename database channel values, task `source` values, or task output keys.
- Do not change runtime behavior or trust gates.

## Verification

- Focused channel-source lane prose test.
- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`
