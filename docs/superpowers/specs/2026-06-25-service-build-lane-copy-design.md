# Service Build Lane Copy Design

## Context

The remaining active operator-facing Bee wording includes service-manager errors, build script output, and release packaging prose. These strings can be shown to an operator during setup, launch-agent maintenance, or release work.

Compatibility identifiers such as `DesktopBeeHelper.app`, `desktopbee-helper`, and service `kind` ids must remain unchanged.

## Goal

Rename visible service/build copy from Bee terms to lane terms while preserving actual helper bundle names and internal ids.

Change:

- `Bee ${kind} ...` errors to `Lane ${kind} ...`
- `Run the Bee build first` to `Run the lane build first`
- `Signing DesktopBeeHelper.app` to `Signing Desktop Lane helper (DesktopBeeHelper.app)`
- release prose to introduce `DesktopBeeHelper.app` as the compatibility bundle name for the Desktop Lane helper

Keep:

- `DesktopBeeHelper.app`
- `desktopbee-helper/DesktopBeeHelper.app`
- service `kind` values such as `inventorbee`
- compatibility route/id names

## Acceptance Criteria

1. Service-manager operator errors use `Lane`, not `Bee`.
2. Build signing output identifies the Desktop Lane helper while preserving `DesktopBeeHelper.app`.
3. Release docs describe `DesktopBeeHelper.app` as the Desktop Lane helper compatibility bundle.
4. A focused regression test fails before production changes and passes afterward.
5. `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs` pass.
