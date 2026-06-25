# Market Insight Lane Prose Design

## Context

The market-data capability is now publicly named Market Insight Lane, but its implementation still uses `src/lib/traderbee/`, `TraderBee*` exported symbols, `/traderbee` routes, and `traderbee.json` as compatibility contracts. Source comments should teach the lane name while preserving those stable internals.

## Approved Direction

Update descriptive prose only:

- Use `Market Insight Lane` for market-data watchlists, Alpaca quote reads, alert polling, and route comments.
- Preserve `TraderBee*` exported names, `/traderbee*` routes, `traderbee.json`, and existing tests that exercise compatibility APIs.
- Keep the safety posture explicit: analysis and alerts only, no trading, no orders, no money movement.

## Scope

Update prose/comments in:

- `src/lib/traderbee/contracts.ts`
- `src/lib/traderbee/provider.ts`
- `src/lib/traderbee/poller.ts`
- `src/lib/traderbee/store.ts`
- `src/daemon/server.ts`

Add a focused regression test that fails on the old comment snippets and passes with lane wording.

## Non-Goals

- Do not rename exported TypeScript symbols.
- Do not rename route paths, persisted JSON filenames, environment variables, or tool ids.
- Do not change Alpaca behavior, alert logic, or notification behavior.

## Verification

- Focused Market Insight Lane prose test.
- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`
