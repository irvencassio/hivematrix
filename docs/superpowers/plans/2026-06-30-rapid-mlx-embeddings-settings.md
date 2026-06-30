# Rapid-MLX Embeddings Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Add failing provider tests in `src/lib/embeddings/provider.test.ts`.
  - Assert `embeddingModelChoices()` includes `rapid-mlx-qwen3-8b` with endpoint `http://localhost:8002/v1` and model `mlx-community/Qwen3-Embedding-8B-4bit-DWQ`.
  - Assert `setEmbeddingsConfig()` writes a sanitized config block and `getEmbeddingsConfig()` reads it back.

- [x] Add failing console tests in `src/daemon/console.test.ts`.
  - Assert the Settings Models panel includes `s_embedding_model`.
  - Assert the browser script includes `saveEmbeddingsSettings()`.
  - Assert the Rapid-MLX Qwen preset name is visible.

- [x] Implement embedding presets and config persistence in `src/lib/embeddings/provider.ts`.
  - Export `RAPID_MLX_QWEN3_EMBEDDING_MODEL`.
  - Export `RAPID_MLX_QWEN3_EMBEDDING_ENDPOINT`.
  - Export `embeddingModelChoices()`.
  - Export `setEmbeddingsConfig()`.

- [x] Extend `src/daemon/server.ts`.
  - Include `embeddings` and `embeddingModelChoices` in `GET /models`.
  - Accept `body.embeddings` in `POST /settings`.
  - Return the saved embeddings config in the settings response.

- [x] Extend `src/daemon/console.ts`.
  - Add an Embeddings block under Settings -> Models.
  - Populate fields on `openSettings()`.
  - Add preset application and save handler.
  - Refresh model/status after saving.

- [x] Configure local runtime.
  - Install `rapid-mlx[embeddings]` in `.rapidmlx-eval/.venv`.
  - Start a Rapid-MLX server on port `8002` locked to `mlx-community/Qwen3-Embedding-8B-4bit-DWQ`.
  - Write HiveMatrix `embeddings` config for `http://localhost:8002/v1`.

- [x] Verify.
  - Run targeted tests first.
  - Run `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
  - Probe `http://localhost:8002/v1/embeddings`.
