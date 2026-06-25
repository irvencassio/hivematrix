# Decisions Settings Lane Copy Design

## Context

`DECISIONS.md` is historical, but it is also active architecture memory for future agents. It still records Settings tab names as `Bees` and describes scenario coverage through `channel Bees`. That conflicts with the lane-name strategy and the screenshot-driven requirement that the settings surface move to Lanes.

## Decision

Update the relevant decision prose to say:

- `channel lanes`
- `new capability-lane proposal`
- `Settings tabs are now Models | Remote | General | Projects | Lanes`
- `Settings tab order defined: Models · Lanes · Projects · General · Remote · About`

Do not rename compatibility ids, route names, source paths, or tool names elsewhere in the file.

## Acceptance Criteria

1. `DECISIONS.md` contains the Lanes settings tab language.
2. `DECISIONS.md` no longer contains `channel Bees`, `new Bee brand`, or settings-tab orders with `Bees`.
3. Existing browser/desktop decisions tests continue to pass.
4. Verification gates pass: `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
