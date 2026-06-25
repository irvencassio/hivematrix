# Active Source Lane Prose Design

## Context

After the larger lane rename work, active source and decision-memory inventory has only a few remaining old public-name prose leaks:

- `src/lib/onboarding/actions.ts` calls the helper the `DesktopBee Swift helper`.
- `src/lib/inventorbee/task-dispatch.ts` calls the deferred stub `InventorBee`.
- `DECISIONS.md` says the video factory is `not a new public Bee brand`.

These are comments/docs only. Compatibility function names, app bundle names, and paths should stay stable.

## Decision

Update the prose to:

- `Desktop Lane Swift helper`
- `Capability design task dispatch deferred`
- `not a new public lane brand`

Preserve:

- `DesktopBeeHelper.app`
- `dispatchInventorBeeTask`
- `src/lib/inventorbee/`
- all route and API compatibility identifiers

## Acceptance Criteria

1. The targeted active source comments use lane/capability wording.
2. `DECISIONS.md` no longer says `not a new public Bee brand`.
3. Compatibility names remain unchanged.
4. Verification gates pass: `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
