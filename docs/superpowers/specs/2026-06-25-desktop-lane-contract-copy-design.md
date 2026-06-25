# Desktop Lane Contract Copy Design

## Context

HiveMatrix now presents embedded capabilities as lanes in Settings, catalog summaries, and model-facing orchestration copy. One remaining high-impact surface is the Desktop Lane task contract in `src/lib/desktopbee/contracts.ts`.

That file still creates default task titles like `DesktopBee: Messages - ...` and generated task descriptions that say `This task came from DesktopBee` and `BrowserBee workflow`. Those strings are read by agents and operators, so they can reintroduce the old voice-hostile naming even though the protocol names remain compatibility identifiers.

## Goal

Move Desktop Lane task titles and generated descriptions to lane language without renaming internal compatibility contracts.

Visible/model-facing changes:

- `DesktopBee:` default task titles -> `Desktop Lane:`
- `This task came from DesktopBee.` -> `This task came from Desktop Lane.`
- `BrowserBee workflow` -> `Browser Lane workflow`

Compatibility that must stay unchanged:

- TypeScript symbols such as `DesktopBeeJobCreatePayload`
- persisted envelope key `desktopbeeRequest`
- `createdVia: "desktopbee.jobs"`
- health field `bee: "desktopbee"`
- action protocol names under `src/lib/desktopbee/`

## Options

### Option A: Rename Everything

Rename the module, types, persisted keys, and endpoint shape. This would be aesthetically clean but too disruptive. Stored task output and API clients may already depend on `desktopbeeRequest` and `desktopbee.jobs`.

### Option B: Rename Only Visible Contract Copy

Keep compatibility identifiers, but make default titles and generated prose say Desktop Lane and Browser Lane. This removes the user/model-facing Bee names while keeping storage and API contracts stable.

### Option C: Leave This For A Later Full Module Rename

Avoids churn today, but keeps agents seeing `DesktopBee` in task descriptions and undermines the lane naming strategy.

## Decision

Use Option B. This is the smallest safe slice that improves the active operator/model surface without breaking existing task envelopes.

## Acceptance Criteria

1. `parseDesktopBeeJobCreate` default titles start with `Desktop Lane:`.
2. `buildDesktopBeeTaskDescription` contains `Desktop Lane` and `Browser Lane workflow`.
3. Generated default contract copy contains no `DesktopBee` or `BrowserBee`.
4. Existing metadata/envelope compatibility remains unchanged.
5. Focused desktop contract tests, `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs` pass.
