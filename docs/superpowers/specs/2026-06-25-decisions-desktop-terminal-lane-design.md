# Decisions Desktop And Terminal Lane Design

## Context

`DECISIONS.md` still has two decision sections that teach DesktopBee/TermBee as names instead of explaining the current lane naming strategy. These are architecture docs read by agents, so they should say Desktop Lane and Terminal Lane while documenting the compatibility names that remain in code.

## Approved Direction

Update `DECISIONS.md` prose only:

- Q1 should say the public name is `Desktop Lane`.
- Q1 should state that `src/lib/desktopbee/` and `DesktopBee*` symbols remain compatibility contracts for now.
- The runtime-registration note should say `Terminal Lane` and `Desktop Lane`.
- Keep route names such as `/desktopbee/health`, descriptor ids such as `desktopbee`, and compatibility function names unchanged.

## Non-Goals

- Do not rename routes, descriptor ids, functions, or compatibility types.
- Do not rewrite unrelated decision history.
- Do not remove historical references where they are naming the old retired `ComputerBee` decision context.

## Verification

- Focused `DECISIONS.md` lane prose test.
- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`
