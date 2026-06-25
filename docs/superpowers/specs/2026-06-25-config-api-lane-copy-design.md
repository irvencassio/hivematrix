# Config API Lane Copy Design

## Context

After the UI/docs/model-facing cleanup, a few active configuration and API surfaces still expose Bee names:

- settings feature label: `Voice (VoiceBee)`
- settings secret purpose: `Market data — TraderBee`
- CTO profile prompt: `new skill, MCP, Bee`
- API errors: `TraderBee not configured`, `unknown bee tool`

These are user/operator/model-facing strings, not compatibility identifiers. They should use lane language while keeping internal route and function names unchanged.

## Goal

Replace visible config/API copy with lane names:

- `Voice Lane`
- `Market Data Lane`
- `new skill, MCP, lane, or shared capability contract`
- `Market Data Lane not configured`
- `unknown lane tool`

Keep existing route paths, module names, function names, test helper names, and compatibility ids unchanged.

## Acceptance Criteria

1. Settings feature labels and secret purposes do not expose public Bee names.
2. Agent profile prompts say `lane`, not `Bee`, for capability invention.
3. API-facing errors say `Market Data Lane` and `unknown lane tool`.
4. A focused regression test fails before the production change and passes afterward.
5. `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs` pass.
