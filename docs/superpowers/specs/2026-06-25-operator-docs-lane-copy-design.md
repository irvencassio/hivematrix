# Operator Docs Lane Copy Design

## Context

The settings UI and model-facing lane copy have moved away from public Bee names, but several active operator docs still describe HiveMatrix capabilities as `Bees` or use public labels such as `DesktopBee`, `MessageBee`, `MailBee`, `BrainBee`, and `ManagerBee`.

These docs are not compatibility contracts. They are setup/runbook surfaces an operator reads when installing, pairing, or validating the appliance. They should match the lane naming strategy.

## Goal

Rename visible operator-doc prose to lane names while preserving compatibility identifiers where they are literal routes, persisted ids, config keys, source values, helper filenames, or historical implementation references.

Use:

- `capability lanes`
- `Browser Lane`
- `Desktop Lane`
- `Message Lane`
- `Mail Lane`
- `Memory Lane`
- `Manager Lane`
- `Terminal Lane`

Keep:

- `/messagebee/*`, `/mailbee/*`, `/desktopbee/*`, `/bees/*`
- `desktopbee_action`
- `browserbee.desktopFallback`
- internal file paths and source ids
- compatibility route explanations

## Acceptance Criteria

1. `docs/USER-GUIDE.html` presents section and table copy as capability lanes, not Bees.
2. `docs/BRINGUP-CHECKLIST.md`, `docs/RELEASE.md`, and `docs/RUNBOOK-appliance-drills.md` use lane names for visible operator copy.
3. Literal route/config/tool identifiers remain unchanged.
4. A focused docs-copy regression test fails before the prose update and passes afterward.
5. `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs` pass.
