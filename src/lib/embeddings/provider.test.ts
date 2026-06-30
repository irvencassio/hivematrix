import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import {
  embeddingModelChoices,
  getEmbeddingsConfig,
  indexDbPath,
  RAPID_MLX_QWEN3_EMBEDDING_ENDPOINT,
  RAPID_MLX_QWEN3_EMBEDDING_MODEL,
  setEmbeddingsConfig,
} from "./provider";

function withTempHome(fn: () => void): void {
  const originalHome = process.env.HOME;
  const tmp = mkdtempSync(join(tmpdir(), "hm-embeddings-"));
  process.env.HOME = tmp;
  try {
    fn();
  } finally {
    if (originalHome) process.env.HOME = originalHome;
    else delete process.env.HOME;
    rmSync(tmp, { recursive: true, force: true });
  }
}

test("embeddingModelChoices includes the Rapid-MLX Qwen3 8B preset on port 8002", () => {
  const choices = embeddingModelChoices();
  const rapid = choices.find((c) => c.id === "rapid-mlx-qwen3-8b");
  assert.ok(rapid, "rapid-mlx qwen preset should be present");
  assert.equal(rapid.endpoint, RAPID_MLX_QWEN3_EMBEDDING_ENDPOINT);
  assert.equal(rapid.model, RAPID_MLX_QWEN3_EMBEDDING_MODEL);
  assert.equal(rapid.provider, "rapid-mlx");
});

test("setEmbeddingsConfig persists a sanitized embeddings block", () => withTempHome(() => {
  setEmbeddingsConfig({
    enabled: true,
    endpoint: " http://localhost:8002/v1/ ",
    model: ` ${RAPID_MLX_QWEN3_EMBEDDING_MODEL} `,
    provider: " rapid-mlx ",
    pollIntervalMinutes: 15.4,
  });

  const cfg = getEmbeddingsConfig();
  assert.deepEqual(cfg, {
    enabled: true,
    endpoint: RAPID_MLX_QWEN3_EMBEDDING_ENDPOINT,
    model: RAPID_MLX_QWEN3_EMBEDDING_MODEL,
    provider: "rapid-mlx",
    pollIntervalMinutes: 15,
  });

  const raw = JSON.parse(readFileSync(join(process.env.HOME!, ".hivematrix", "config.json"), "utf-8"));
  assert.equal(raw.embeddings.enabled, true);
  assert.equal(raw.embeddings.endpoint, RAPID_MLX_QWEN3_EMBEDDING_ENDPOINT);
}));

test("getEmbeddingsConfig returns no sub-objects when not in config", () => withTempHome(() => {
  setEmbeddingsConfig({ enabled: true });
  const cfg = getEmbeddingsConfig();
  assert.ok(cfg, "should return a config");
  assert.equal("index" in cfg!, false, "index should be absent when not configured");
  assert.equal("hybrid" in cfg!, false, "hybrid should be absent when not configured");
  assert.equal("mmr" in cfg!, false, "mmr should be absent when not configured");
  assert.equal("temporalDecay" in cfg!, false, "temporalDecay should be absent when not configured");
}));

test("setEmbeddingsConfig round-trips sub-objects with defaults applied", () => withTempHome(() => {
  setEmbeddingsConfig({
    enabled: true,
    index: { driver: "sqlite", path: "~/.hivematrix/brain-index.sqlite", chunkWords: 400, chunkOverlapWords: 80 },
    hybrid: { enabled: true, textWeight: 0.3, vectorWeight: 0.7, candidateMultiplier: 3 },
    mmr: { enabled: true, lambda: 0.6 },
    temporalDecay: { enabled: false, halfLifeDays: 14 },
  });
  const cfg = getEmbeddingsConfig();
  assert.ok(cfg);
  assert.deepEqual(cfg!.index, { driver: "sqlite", path: "~/.hivematrix/brain-index.sqlite", chunkWords: 400, chunkOverlapWords: 80 });
  assert.deepEqual(cfg!.hybrid, { enabled: true, textWeight: 0.3, vectorWeight: 0.7, candidateMultiplier: 3 });
  assert.deepEqual(cfg!.mmr, { enabled: true, lambda: 0.6 });
  assert.deepEqual(cfg!.temporalDecay, { enabled: false, halfLifeDays: 14 });
}));

test("normalizeEmbeddingsConfig applies defaults to partially-specified sub-objects", () => withTempHome(() => {
  const tmp = mkdtempSync(join(tmpdir(), "hm-cfg-"));
  mkdirSync(join(tmp, ".hivematrix"), { recursive: true });
  writeFileSync(
    join(tmp, ".hivematrix", "config.json"),
    JSON.stringify({ embeddings: { enabled: true, index: {}, hybrid: {}, mmr: {}, temporalDecay: {} } }),
  );
  const savedHome = process.env.HOME;
  process.env.HOME = tmp;
  try {
    const cfg = getEmbeddingsConfig();
    assert.ok(cfg);
    assert.deepEqual(cfg!.index, { driver: "sqlite", path: "~/.hivematrix/brain-index.sqlite", chunkWords: 500, chunkOverlapWords: 100 });
    assert.deepEqual(cfg!.hybrid, { enabled: true, textWeight: 0.45, vectorWeight: 0.55, candidateMultiplier: 4 });
    assert.deepEqual(cfg!.mmr, { enabled: true, lambda: 0.7 });
    assert.deepEqual(cfg!.temporalDecay, { enabled: false, halfLifeDays: 30 });
  } finally {
    process.env.HOME = savedHome;
    rmSync(tmp, { recursive: true, force: true });
  }
}));

test("mmr.lambda is clamped to [0, 1]", () => withTempHome(() => {
  const tmp = mkdtempSync(join(tmpdir(), "hm-mmr-"));
  mkdirSync(join(tmp, ".hivematrix"), { recursive: true });
  writeFileSync(
    join(tmp, ".hivematrix", "config.json"),
    JSON.stringify({ embeddings: { enabled: true, mmr: { enabled: true, lambda: 1.5 } } }),
  );
  const savedHome = process.env.HOME;
  process.env.HOME = tmp;
  try {
    const cfg = getEmbeddingsConfig();
    assert.equal(cfg!.mmr!.lambda, 1);
  } finally {
    process.env.HOME = savedHome;
    rmSync(tmp, { recursive: true, force: true });
  }
}));

test("indexDbPath resolves tilde to home directory", () => {
  const resolved = indexDbPath(null);
  assert.ok(resolved.startsWith(homedir()), "should resolve ~ to homedir");
  assert.ok(resolved.endsWith("brain-index.sqlite"), "should end with brain-index.sqlite");
});

test("indexDbPath uses configured path when present", () => withTempHome(() => {
  setEmbeddingsConfig({ enabled: true, index: { driver: "sqlite", path: "/custom/path/brain.sqlite", chunkWords: 500, chunkOverlapWords: 100 } });
  const resolved = indexDbPath();
  assert.equal(resolved, "/custom/path/brain.sqlite");
}));
