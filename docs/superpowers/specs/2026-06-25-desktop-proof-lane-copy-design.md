# Desktop Proof Lane Copy Design

## Context

The proof script `scripts/desktopbee-proof.mts` is an operator-facing gate for native desktop automation. It still prints and types strings such as:

- `DesktopBee Phase 4 Proof`
- `HiveMatrix DesktopBee proof`
- `Requires: DesktopBee helper`

The filename and API calls remain compatibility-oriented, but the text shown to an operator during the proof run should use the lane naming strategy.

## Goal

Update the proof script's visible output and top-level operator comments to `Desktop Lane` language while preserving compatibility imports and helper APIs.

Keep:

- `scripts/desktopbee-proof.mts`
- `dispatchDesktopBeeAction`
- `probeDesktopBeeHelper`
- action payloads and helper protocol names

Change:

- visible proof title
- sample typed/setValue text
- operator-facing header comments

## Decision

Rename only active proof copy. This is low-risk and keeps build/release scripts stable.

## Acceptance Criteria

1. Proof output title says `Desktop Lane Phase 4 Proof`.
2. Sample text says `HiveMatrix Desktop Lane proof`.
3. The proof script source no longer contains operator-facing `DesktopBee Phase 4 Proof`, `HiveMatrix DesktopBee proof`, or `Requires: DesktopBee helper`.
4. Compatibility imports and function calls remain unchanged.
5. Focused script test, `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs` pass.
