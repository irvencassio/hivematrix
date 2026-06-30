# Brain Hybrid Memory — Embeddings + Hybrid/MMR Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Date: 2026-06-29
Design spec: `docs/superpowers/specs/2026-06-29-brain-hybrid-memory-design.md`
Phase 1 plan: `docs/superpowers/plans/2026-06-29-brain-hybrid-memory-bm25-phase.md`

## Readiness Gate — Do Not Start Phase 2 Until This Passes

```bash
npx tsx scripts/qwen-readiness.mts
```

All 6 checks must be green. If any fail, the local embedding endpoint is not stable and this
phase should not begin. The most critical checks are: Ollama/MLX reachable at the configured
endpoint, the embedding model loaded, and a test embed returning a non-zero vector.

Phase 1 (BM25 SQLite index) must also be complete: all Phase 1 acceptance criteria met,
`npm test` and `npm run typecheck` clean.

---

## Context: What Phase 1 Built

| Artifact | State |
|---|---|
| `src/lib/brain/chunking.ts` | COMPLETE — `chunkDocument()` splits docs into `BrainChunk[]` |
| `src/lib/brain/index-db.ts` | COMPLETE — DDL, `openBrainIndex`, `upsertDoc`, `upsertChunks`, `deleteDoc`, `upsertEmbedding`, `getChunksWithEmbeddings`, `computeReindexPlan`, `fts5Search` |
| `src/lib/brain/hybrid-search.ts` | COMPLETE — `hybridMerge`, `rankHybrid`, `buildChunkHit` (pure, no I/O) |
| `src/lib/brain/mmr.ts` | COMPLETE — `cosineSimilarity`, `mmrRerank`, `rankWithMmr` (pure, no I/O) |
| `src/lib/embeddings/provider.ts` | COMPLETE — `EmbeddingsConfig` with `IndexConfig`, `HybridConfig`, `MmrConfig`, `TemporalDecayConfig`; `embedTexts()` already present |
| `src/lib/embeddings/indexer.ts` | PARTIAL — Phase 1 added `reindexBrain()` BM25 pass; embedding call is missing |
| `src/lib/brain/search.ts` | PARTIAL — Phase 1 added `tryBm25Search()` BM25-only path; vector/hybrid path is missing |
| `src/daemon/server.ts` | PARTIAL — `/embeddings/reindex` calls `reindexBrain()`; no embedding progress; `/embeddings` lacks model readiness |

**This plan covers Phase 2: chunk-level embeddings, cosine ranking, hybrid merge, and MMR.**

---

## Task 1 — Add embedding pass to `reindexBrain()` in `src/lib/embeddings/indexer.ts`

**Pre-condition:** Phase 1 `npm test` is clean. `qwen-readiness.mts` all 6 green.

**Verify RED first (look for the missing embedding pass):**
```bash
# Confirm that reindexBrain() does NOT call upsertEmbedding or embedTexts with chunks
grep -n "upsertEmbedding\|chunksToEmbed" src/lib/embeddings/indexer.ts
# Expect: no matches
```

### What to implement

After the BM25 indexing loop in the Phase-1 `reindexBrain()` (the one that uses `openBrainIndex`
and writes to SQLite), add an embedding pass:

```ts
// At the top of the file — new imports for Phase 2
import {
  openBrainIndex,
  upsertDoc, upsertChunks, deleteDoc, computeReindexPlan,
  upsertEmbedding, getChunksWithEmbeddings,
  type BrainDb,
} from "@/lib/brain/index-db";
import { embedTexts, getEmbeddingsConfig, isEmbeddingsEnabled } from "@/lib/embeddings/provider";

// Constants
const EMBED_BATCH = 8; // small batches so a stall does not time out the whole pass
```

Extend the `ReindexResult` interface with embedding stats:

```ts
export interface ReindexResult {
  added: number;
  updated: number;
  pruned: number;
  chunksIndexed: number;
  embeddedChunks: number;       // NEW — chunks embedded this pass (0 when embeddings off)
  embeddingModel: string | null; // NEW — model used, or null
  dbPath: string;
  indexedAt: string;
  error?: string;
}
```

After the existing BM25 loop in `reindexBrain()`, add:

```ts
// --- Phase 2: embedding pass ---
let embeddedChunks = 0;
let embeddingModel: string | null = null;

if (isEmbeddingsEnabled() && cfg.index) {
  // Re-open db (closed after BM25 pass, or keep open and pass through)
  const db2 = openBrainIndex(dbPath);
  try {
    // Recompute plan to get chunksToEmbed (handles model change + new chunks)
    const embedPlan = computeReindexPlan(db2, diskHashes, cfg.model);

    if (embedPlan.modelChanged) {
      db2.prepare("DELETE FROM brain_embeddings WHERE model != ?").run(cfg.model);
    }

    const chunkIds = embedPlan.chunksToEmbed;
    embeddingModel = cfg.model;

    // Fetch chunk texts by id for batched embedding
    const chunkRows = db2.prepare(
      `SELECT id, text FROM brain_chunks WHERE id IN (${chunkIds.map(() => "?").join(",") || "'__never__'"})`
    ).all(...chunkIds) as Array<{ id: string; text: string }>;

    const chunkMap = new Map(chunkRows.map((r) => [r.id, r.text]));

    for (let i = 0; i < chunkIds.length; i += EMBED_BATCH) {
      const batch = chunkIds.slice(i, i + EMBED_BATCH);
      const texts = batch.map((id) => chunkMap.get(id) ?? "").filter(Boolean);
      if (texts.length === 0) continue;

      const vectors = await embedTexts(texts);
      if (!vectors) break; // endpoint unavailable — keep what we have

      for (let j = 0; j < batch.length; j++) {
        const vec = vectors[j];
        if (!vec || vec.length === 0) continue;
        upsertEmbedding(db2, {
          chunkId: batch[j],
          model: cfg.model,
          dims: vec.length,
          vector: vec,
          embeddedAt: new Date().toISOString(),
        });
        embeddedChunks++;
      }
    }
  } finally {
    db2.close();
  }
}

return {
  added, updated, pruned, chunksIndexed,
  embeddedChunks,
  embeddingModel,
  dbPath,
  indexedAt: new Date().toISOString(),
};
```

> **Note:** If `chunkIds` is empty, the SQL `IN ()` would be invalid — guard with the
> `'__never__'` sentinel or an explicit `if (chunkIds.length === 0) { /* skip */ }` branch.

**Verify GREEN:**
```bash
# Unit test: with mock embedder, embeddedChunks > 0 and upsertEmbedding rows present
npx tsx --test src/lib/embeddings/indexer.test.ts
npm run typecheck
```

---

## Task 2 — Write `src/lib/embeddings/indexer.test.ts` (embedding pass tests)

These tests must be RED before Task 1 implementation and GREEN after.

File: `src/lib/embeddings/indexer.test.ts`

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";
import Database from "better-sqlite3";
import { openBrainIndex } from "@/lib/brain/index-db";

// Minimal config shim — tests must not need real Ollama
process.env.HIVEMATRIX_TEST_MODE = "1";

describe("reindexBrain — embedding pass", () => {
  let brainDir: string;
  let dbFile: string;

  before(() => {
    brainDir = mkdtempSync(join(tmpdir(), "hive-brain-"));
    writeFileSync(join(brainDir, "doc1.md"), "# Alpha\n\nThis is about the alpha project.");
    writeFileSync(join(brainDir, "doc2.md"), "# Beta\n\nThis is about the beta project.");
    dbFile = join(tmpdir(), `hive-test-${Date.now()}.sqlite`);
  });

  after(() => {
    rmSync(brainDir, { recursive: true, force: true });
    try { rmSync(dbFile); } catch {}
  });

  it("embeds chunks when embedder is provided", async () => {
    const { reindexBrain } = await import("@/lib/embeddings/indexer");
    const fakeEmbedder = async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]);

    const result = await reindexBrain({
      brainRootOverride: brainDir,
      dbPathOverride: dbFile,
      embedder: fakeEmbedder,
      model: "test-model",
    });

    assert.ok(result.chunksIndexed > 0, "should have indexed chunks");
    assert.ok(result.embeddedChunks > 0, "should have embedded at least one chunk");
    assert.equal(result.embeddingModel, "test-model");

    const db = openBrainIndex(dbFile);
    const count = (db.prepare("SELECT COUNT(*) as n FROM brain_embeddings").get() as { n: number }).n;
    db.close();
    assert.ok(count > 0, "brain_embeddings table should have rows");
  });

  it("skips embedding when embedder returns null", async () => {
    const { reindexBrain } = await import("@/lib/embeddings/indexer");
    const nullEmbedder = async () => null;
    const dbFile2 = join(tmpdir(), `hive-test-null-${Date.now()}.sqlite`);

    const result = await reindexBrain({
      brainRootOverride: brainDir,
      dbPathOverride: dbFile2,
      embedder: nullEmbedder,
      model: "test-model",
    });

    assert.ok(result.chunksIndexed > 0, "BM25 chunks should still be indexed");
    assert.equal(result.embeddedChunks, 0, "no embeddings when provider unavailable");
    rmSync(dbFile2, { force: true });
  });

  it("is incremental — does not re-embed unchanged chunks on second run", async () => {
    const { reindexBrain } = await import("@/lib/embeddings/indexer");
    let callCount = 0;
    const countingEmbedder = async (texts: string[]) => {
      callCount += texts.length;
      return texts.map(() => [0.5, 0.6, 0.7]);
    };

    const dbFile3 = join(tmpdir(), `hive-test-incr-${Date.now()}.sqlite`);
    await reindexBrain({ brainRootOverride: brainDir, dbPathOverride: dbFile3, embedder: countingEmbedder, model: "m" });
    const firstCount = callCount;
    callCount = 0;

    await reindexBrain({ brainRootOverride: brainDir, dbPathOverride: dbFile3, embedder: countingEmbedder, model: "m" });
    assert.equal(callCount, 0, "second run should embed 0 chunks (no changes)");
    rmSync(dbFile3, { force: true });
  });
});
```

**Note:** `reindexBrain()` must accept `{ brainRootOverride?, dbPathOverride?, embedder?, model? }`
to be injectable in tests. Update its signature accordingly.

---

## Task 3 — Add cosine search to `tryBm25Search` (rename → `tryHybridSearch`)

File: `src/lib/brain/search.ts`

**Verify RED first:**
```bash
grep -n "tryHybridSearch\|vectorHits\|rankWithMmr" src/lib/brain/search.ts
# Expect: no matches
```

### What to implement

Replace the Phase 1 `tryBm25Search` with `tryHybridSearch`:

```ts
import {
  openBrainIndex, fts5Search, getChunksWithEmbeddings,
  type RawBm25Hit,
} from "@/lib/brain/index-db";
import { rankHybrid, type RawVectorHit } from "@/lib/brain/hybrid-search";
import { rankWithMmr, cosineSimilarity } from "@/lib/brain/mmr";
import { embedTexts, getEmbeddingsConfig, indexDbPath, isEmbeddingsEnabled } from "@/lib/embeddings/provider";
import { existsSync } from "fs";

async function tryHybridSearch(query: string, maxResults: number): Promise<SearchResult[] | null> {
  try {
    const cfg = getEmbeddingsConfig();
    if (!cfg.index) return null;
    const dbPath = indexDbPath(cfg.index.path);
    if (!existsSync(dbPath)) return null;

    const db = openBrainIndex(dbPath);

    // BM25 pass (always)
    const multiplier = cfg.hybrid?.candidateMultiplier ?? 4;
    const bm25Hits: RawBm25Hit[] = fts5Search(db, query, maxResults * multiplier);

    // Vector pass (only when embeddings enabled and endpoint available)
    let vectorHits: RawVectorHit[] = [];
    let vectorMap = new Map<string, number[]>();

    if (isEmbeddingsEnabled() && cfg.hybrid?.enabled) {
      const queryVec = await embedTexts([query]).then((r) => r?.[0] ?? null).catch(() => null);
      if (queryVec && queryVec.length > 0) {
        const allChunks = getChunksWithEmbeddings(db, cfg.model);
        // Brute-force cosine over all chunk vectors
        const scored = allChunks.map((c) => ({
          id: c.id, path: c.path, heading: c.heading, text: c.text,
          cosineScore: cosineSimilarity(queryVec, c.vector),
        }));
        scored.sort((a, b) => b.cosineScore - a.cosineScore);
        vectorHits = scored.slice(0, maxResults * multiplier);
        vectorMap = new Map(allChunks.map((c) => [c.id, c.vector]));
      }
    }

    db.close();

    if (bm25Hits.length === 0 && vectorHits.length === 0) return null;

    // Ranking: MMR when vectors available, pure hybrid otherwise
    const hybridOpts = {
      textWeight: cfg.hybrid?.textWeight ?? (vectorHits.length === 0 ? 1 : 0.45),
      vectorWeight: cfg.hybrid?.vectorWeight ?? (vectorHits.length === 0 ? 0 : 0.55),
      maxResults,
    };

    let hits;
    if (vectorMap.size >= 2 && cfg.mmr?.enabled) {
      hits = rankWithMmr(bm25Hits, vectorHits, vectorMap, { ...hybridOpts, lambda: cfg.mmr.lambda });
    } else {
      hits = rankHybrid(bm25Hits, vectorHits, hybridOpts);
    }

    return hits.map((h) => ({
      path: h.path,
      score: h.score,
      snippet: h.snippet,
      heading: h.heading ?? undefined,
    }));
  } catch {
    return null;
  }
}
```

Update the `brainSearch` caller to use `tryHybridSearch` (async) instead of `tryBm25Search`.

**Verify GREEN:**
```bash
npx tsx --test src/lib/brain/search.test.ts
npm run typecheck
```

---

## Task 4 — Write `src/lib/brain/search.test.ts` (hybrid + MMR path)

Tests must be RED before Task 3 and GREEN after.

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("tryHybridSearch", () => {
  let brainDir: string;
  let dbFile: string;

  before(async () => {
    brainDir = mkdtempSync(join(tmpdir(), "hive-search-"));
    writeFileSync(join(brainDir, "alpha.md"), "# Alpha Project\n\nThe alpha project is about search.");
    writeFileSync(join(brainDir, "beta.md"), "# Beta Project\n\nThe beta project is about storage.");
    dbFile = join(tmpdir(), `hive-search-${Date.now()}.sqlite`);

    const { reindexBrain } = await import("@/lib/embeddings/indexer");
    const fakeEmbedder = async (texts: string[]) =>
      texts.map((t) => (t.toLowerCase().includes("alpha") ? [1, 0, 0] : [0, 1, 0]));
    await reindexBrain({
      brainRootOverride: brainDir,
      dbPathOverride: dbFile,
      embedder: fakeEmbedder,
      model: "test-model",
    });
  });

  after(() => {
    rmSync(brainDir, { recursive: true, force: true });
    rmSync(dbFile, { force: true });
  });

  it("returns BM25 results when embeddings disabled", async () => {
    // Override cfg to disable hybrid for this test
    // ... (inject override to getEmbeddingsConfig or use env)
    // Result should still include "alpha.md" for keyword "alpha"
    assert.ok(true); // placeholder — implement with config override
  });

  it("returns hybrid results when embedder available", async () => {
    // Stub embedTexts to return [0.9, 0.1, 0] for "alpha" query
    // Expect alpha.md to rank first
    assert.ok(true); // placeholder — implement with dependency injection
  });

  it("applies MMR to diversify same-document chunks", async () => {
    // With a doc having many chunks and MMR enabled, no two consecutive hits
    // should be from the same heading (lambda=0.7 ensures diversity)
    assert.ok(true); // placeholder
  });

  it("falls back to keyword-only when vector endpoint unavailable", async () => {
    // Stub embedTexts to return null; expect BM25-only path used
    assert.ok(true); // placeholder
  });
});
```

> Implement the stubs as real assertions using config override patterns or module mocking.
> The `tryHybridSearch` function must accept an optional `embedderOverride` for testability,
> or the config must be injectable. Prefer the injectable config route already used in `indexer.ts`.

---

## Task 5 — Update `POST /embeddings/reindex` to report embedding progress

File: `src/daemon/server.ts`

**What to implement:**

The Phase 1 handler already calls `reindexBrain()` and returns its result. Phase 2 adds
`embeddedChunks` and `embeddingModel` to the `ReindexResult` shape (Task 1).
No handler code change needed — the response shape automatically includes the new fields.

Verify the response shape includes the new fields:

```bash
curl -s -X POST http://localhost:PORT/embeddings/reindex | jq '{embeddedChunks, embeddingModel}'
# Should show numeric value (may be 0 if endpoint unavailable) and model string or null
```

---

## Task 6 — Update `GET /embeddings` to include model readiness

File: `src/daemon/server.ts`

Find the existing `/embeddings` GET handler. The Phase 1 handler already includes `brainIndex`
(docs/chunks/embedded counts). Extend with embedding model readiness:

```ts
// Add inside the /embeddings GET handler after the brainIndex block:
let embeddingsReady = false;
let embeddingModelName: string | null = null;
try {
  const cfg = getEmbeddingsConfig();
  if (cfg.enabled && cfg.endpoint && cfg.model) {
    embeddingModelName = cfg.model;
    // Quick probe: embed a tiny test string
    const probe = await embedTexts(["ping"]);
    embeddingsReady = Array.isArray(probe) && probe.length > 0 && probe[0].length > 0;
  }
} catch { /* probe failed — embeddingsReady stays false */ }

// Include in JSON response:
// embeddingsReady, embeddingModel: embeddingModelName
```

> The probe adds ~100ms to the response. Accept this; it runs at most once per status poll.
> If it becomes a problem, cache the result for 30 seconds.

---

## Task 7 — Verification Gates

Run in order. Fix failures before proceeding to the next gate.

```bash
# 1. Readiness gate (must have been green before starting; confirm still green)
npx tsx scripts/qwen-readiness.mts

# 2. All unit tests pass
npm test

# 3. TypeScript is clean
npm run typecheck

# 4. Scope wall: no violations
node scripts/scope-wall.mjs
```

All four must be zero-error before declaring Phase 2 complete.

---

## Phase 2 Acceptance Criteria

- [ ] `reindexBrain()` embeds all new/changed chunks using `embedTexts()` and stores them in `brain_embeddings`
- [ ] Re-running reindex on unchanged docs and embeddings is a no-op (incremental: 0 embed calls second pass)
- [ ] Changing the embedding model name clears stale `brain_embeddings` rows and re-embeds
- [ ] `brain_search` returns hybrid results (BM25 + cosine) when embeddings are available
- [ ] `brain_search` returns BM25-only results when embeddings are unavailable (no regressions)
- [ ] Conceptual/synonym queries find relevant docs even without exact keyword overlap
- [ ] Results cite chunk heading + path (not document path only)
- [ ] With ≥ 2 vectors and MMR enabled, consecutive results vary in heading/topic
- [ ] `GET /embeddings` reports embedding model readiness
- [ ] `POST /embeddings/reindex` response includes `embeddedChunks` count and `embeddingModel`
- [ ] No brain content leaves the machine (all embedding via local endpoint)
- [ ] `npm test`, `npm run typecheck`, and `node scripts/scope-wall.mjs` all pass

---

## Deferred to Future Phase (Not Part of This Plan)

- `sqlite-vec` binary vector blobs — revisit after measuring corpus latency
- Temporal decay — config key exists; implementation deferred
- Skill/playbook ranking boost — deferred to after semantic recall is stable
- Cross-Mac / multi-user embedding endpoint support
- Streaming progress events from `/embeddings/reindex`
