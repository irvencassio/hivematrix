# Rapid-MLX Embeddings Settings Design

## Context

HiveMatrix already has a local-first embeddings provider and status API, but embeddings are only configurable by editing `~/.hivematrix/config.json`. The operator wants `mlx-community/Qwen3-Embedding-8B-4bit-DWQ` running through Rapid-MLX on port `8002`, then selectable from Settings under Models.

## Approaches Considered

### 1. Keep embeddings manual

Leave the runtime and config as-is and document the JSON block. This is lowest code risk, but it fails the operator request because Settings remains display-only.

### 2. Add a dedicated embedding selector in Settings

Keep task/chat model choices separate from embedding model choices. Add curated embedding presets, persist `embeddings.enabled`, `endpoint`, `model`, and `provider`, and reuse the existing `/embeddings` status and reindex flow. This matches the current architecture and avoids mixing vector models into task execution choices.

### 3. Promote embeddings into local-engine tiers

Add an `embedding` tier beside `fast` and `coding`. This could help future process supervision, but it would expand the tier enum and routing contracts for a runtime that does not behave like a chat tier.

## Selected Design

Use approach 2.

Settings -> Models gets an Embeddings row with:

- Enable checkbox.
- Preset select with `Rapid-MLX Qwen3 Embedding 8B` as the primary choice.
- Endpoint and model fields so the operator can override without editing JSON.
- Save action that writes the existing `embeddings` config block.

The daemon returns embedding choices and current embedding config from `/models`, accepts an `embeddings` payload on `POST /settings`, and keeps `/embeddings` as the live status/reindex API.

## Runtime Setup

Run Rapid-MLX on `8002` with:

- Endpoint: `http://localhost:8002/v1`
- Embedding model: `mlx-community/Qwen3-Embedding-8B-4bit-DWQ`
- Provider: `rapid-mlx`

If this Rapid-MLX version cannot serve embeddings without a primary chat model, keep the server on `8002` but lock `--embedding-model` to the requested model.

## Verification

- Failing tests first for embedding choices/config persistence and Settings UI hooks.
- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`
- Runtime proof: `GET /v1/models` and `POST /v1/embeddings` against `localhost:8002`.
- Because the production change touches embeddings/settings, not Qwen chat readiness internals, `npx tsx scripts/qwen-readiness.mts` is optional unless local-model routing files are changed.
