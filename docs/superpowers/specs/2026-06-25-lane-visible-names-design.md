# Lane Visible Names Design

## Context

HiveMatrix has adopted the lane naming strategy for user-facing capability surfaces. The desktop Settings screen now has a Lanes tab and the daemon exposes `GET /lanes`, but screenshots from the running app still show Bee-branded cards such as `MessageBee`, `MailBee`, `WebBee`, and `ManagerBee`.

The likely cause is a mix of stale clients, compatibility `/bees` responses, and remaining visible strings in the console. Internal module names such as `messagebee` and `mailbee` can remain for compatibility, but the operator-facing product language should be lanes.

## Goals

1. Settings capability cards show lane names, not Bee product names.
2. The compatibility `/bees` endpoint no longer leaks raw Bee display names to older Settings clients.
3. Guided setup and safe-sender UI use Message Lane and Mail Lane labels.
4. Task execution provenance uses lane language where visible to the operator.

## Non-Goals

1. Rename internal TypeScript modules or persisted source identifiers.
2. Remove compatibility routes such as `/messagebee` and `/mailbee`.
3. Rewrite historical docs that intentionally describe past Bee architecture.
4. Change the Browser Lane workflow/read implementation split.

## Approach

Use lane names at the display/catalog boundary:

- Keep `kind` values such as `messagebee`, `mailbee`, and `managerbee` where existing internals expect them.
- Change catalog `name` fields to lane labels.
- Shape `/bees` compatibility output through the lane status adapter so old clients receive lane names too.
- Update visible console strings for setup modals, safe sender headings, and execution provenance.
- Add tests that pin these visible strings and catalog values.

## Lane Name Mapping

| Internal kind | Visible label |
| --- | --- |
| `messagebee` | Message Lane |
| `mailbee` | Mail Lane |
| `webbee` / `browserbee` | Browser Lane |
| `termbee` | Terminal Lane |
| `desktopbee` | Desktop Lane |
| `brainbee` | Memory Lane |
| `managerbee` | Review Lane |

## Risks

The `/bees` endpoint changes shape from raw Bee kinds to lane kinds while still using the `bees` response key. This is acceptable because legacy compatibility is not a priority for the current strategy, and it reduces the chance of stale Settings code presenting old names.

## Verification

- Targeted catalog, lane status, console, and server tests.
- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`
