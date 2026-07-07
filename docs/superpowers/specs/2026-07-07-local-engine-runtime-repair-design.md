# Local Engine Runtime Repair Design

## Context

On July 7, 2026, the Settings screenshot showed `Local engine - Rapid-MLX`
with `fast` not running on `:8000` and `coding` running on `:8001`, even
though this 52 GB Apple Silicon Mac is in the `48gb` memory tier and should
run only the `fast` resident tier by default.

Investigation found a split configuration:

- `localEngine` was provisioned for `fast` only.
- Existing `qwen` and legacy `localModel` config still pointed at the
  `coding` tier on `:8001`.
- A legacy LaunchAgent, `com.hivematrix.rapidmlx.coding`, was keeping
  `qwen3.6-27b-4bit` alive.
- No process was listening on `:8000`.
- The `Local model health` card was reading a cached readiness record, so it
  could show unrelated stale state beside the live Rapid-MLX engine card.

Embedding behavior is intentionally out of scope for this repair.

## Approved Approach

Make the provisioned Rapid-MLX engine the source of truth for HiveMatrix-managed
local Qwen routing. When provisioning computes that this Mac should run `fast`,
HiveMatrix should update stale managed `qwen` and `localModel` entries from the
old `coding` tier to `fast`. It should still preserve custom user endpoints that
are not recognized HiveMatrix Rapid-MLX tier aliases.

Treat configured `localEngine.tiers` as authoritative. If a provisioned config
lists only `fast`, status and role routing should not silently re-add `coding`
as a configured tier. Supported presets may still appear as optional UI rows.

When the local serving supervisor owns a Qwen profile that targets a Rapid-MLX
tier alias, it should launch `rapid-mlx serve` for that tier. It should only use
`mlx_lm.server` for non-tier custom MLX models.

Remove the separate `Local model health` Settings card. The live local-engine
card already reports the actionable Rapid-MLX tier state, and the cached health
card is too easy to misread after provisioning or tier changes.

Finally, repair this Mac's live runtime by stopping the stale coding LaunchAgent,
writing the config to the recommended fast endpoint, and starting the fast
LaunchAgent on `:8000`.

## Alternatives Considered

1. Preserve all existing Qwen profiles forever.
   This avoids overwriting custom endpoints, but it leaves provisioning unable
   to fix stale HiveMatrix-managed tier config. That is the root of this bug.

2. Start both `fast` and `coding` on this Mac.
   That contradicts the memory preset for a 52 GB machine and risks memory
   pressure. The provisioner already chose `fast` only for this tier.

3. Keep the cached `Local model health` card and add explanatory copy.
   More copy would not fix the mismatch. The live local-engine card is the
   correct operator surface for Rapid-MLX process health.

## Test Plan

- Unit test provisioning profile sync:
  stale managed `qwen`/`localModel` entries pointing to `coding` become `fast`
  for a 48 GB plan.
- Unit test preservation:
  custom non-tier Qwen profiles are not overwritten.
- Unit test tier parsing:
  a configured one-tier `localEngine` does not backfill absent default tiers.
- Unit test serve command selection:
  Rapid-MLX tier aliases launch through `rapid-mlx serve`, while custom MLX
  models still use `mlx_lm.server`.
- Verify with focused tests, then the repo gates:
  `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`, and
  `npx tsx scripts/qwen-readiness.mts` after live runtime repair.

## Out Of Scope

- Embeddings configuration, indexing, or health checks.
- Changing memory-tier thresholds.
- Adding new local model families.
- Changing cloud/frontier routing policy.
