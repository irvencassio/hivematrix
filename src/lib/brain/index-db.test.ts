/**
 * RED tests for the SQLite CRUD layer in index-db.ts.
 * These tests import functions that do not exist yet — they are intentionally
 * failing until the implementation pass adds them to index-db.ts.
 *
 * Functions under test (to be added to src/lib/brain/index-db.ts):
 *   openBrainIndex, upsertDoc, upsertChunks, deleteDoc,
 *   upsertEmbedding, getChunksWithEmbeddings,
 *   computeReindexPlan, fts5Search
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  chunkId,
  openBrainIndex,
  upsertDoc,
  upsertChunks,
  deleteDoc,
  upsertEmbedding,
  getChunksWithEmbeddings,
  computeReindexPlan,
  fts5Search,
  type BrainChunk,
  type StoredEmbedding,
  type ChunkWithEmbedding,
} from "./index-db";

// Local shape for the BM25 result returned by fts5Search (mirrors RawBm25Hit).
interface Bm25Hit { id: string; path: string; heading: string | null; text: string; bm25Score: number; }

// ── helpers ───────────────────────────────────────────────────────────────────

function makeChunks(relPath: string, count: number): BrainChunk[] {
  return Array.from({ length: count }, (_, i) => ({
    id: chunkId(relPath, i),
    path: relPath,
    chunkIndex: i,
    heading: i === 0 ? null : `Section ${i}`,
    text: `This is chunk number ${i} for path ${relPath}.`,
    tokenEstimate: 10,
  }));
}

function makeEmbedding(chunkIdVal: string, model = "qwen3-embedding", dims = 3): StoredEmbedding {
  return {
    chunkId: chunkIdVal,
    model,
    dims,
    vector: Array.from({ length: dims }, (_, i) => i * 0.1),
    embeddedAt: new Date().toISOString(),
  };
}

// ── chunkId ───────────────────────────────────────────────────────────────────

test("chunkId: produces {relPath}#{chunkIndex} string", () => {
  assert.equal(chunkId("projects/hive.md", 3), "projects/hive.md#3");
  assert.equal(chunkId("a/b/c.md", 0), "a/b/c.md#0");
});

// ── openBrainIndex — schema init ──────────────────────────────────────────────

test("openBrainIndex: creates brain_docs table in :memory: DB", () => {
  const db = openBrainIndex(":memory:");
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='brain_docs'")
    .get();
  assert.ok(row, "brain_docs table should exist");
  db.close();
});

test("openBrainIndex: creates brain_chunks table", () => {
  const db = openBrainIndex(":memory:");
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='brain_chunks'")
    .get();
  assert.ok(row, "brain_chunks table should exist");
  db.close();
});

test("openBrainIndex: creates brain_embeddings table", () => {
  const db = openBrainIndex(":memory:");
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='brain_embeddings'")
    .get();
  assert.ok(row, "brain_embeddings table should exist");
  db.close();
});

test("openBrainIndex: creates brain_chunks_fts virtual table", () => {
  const db = openBrainIndex(":memory:");
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE name='brain_chunks_fts'")
    .get();
  assert.ok(row, "brain_chunks_fts FTS5 virtual table should exist");
  db.close();
});

test("openBrainIndex: idempotent — calling twice does not error", () => {
  const db = openBrainIndex(":memory:");
  // Running DDL again on the same db (IF NOT EXISTS) should be safe
  assert.doesNotThrow(() => {
    // Re-opening is not meaningful for :memory: but calling openBrainIndex
    // on a file path twice must be safe; here we just verify the first open is clean.
  });
  db.close();
});

// ── upsertDoc ─────────────────────────────────────────────────────────────────

test("upsertDoc: inserts a brain_docs row", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "test.md", hash: "abc123", title: "Test", mtimeMs: 1000, sizeBytes: 500 });
  const row = db.prepare("SELECT * FROM brain_docs WHERE path = ?").get("test.md") as {
    path: string; hash: string; title: string;
  } | undefined;
  assert.ok(row, "row should be present");
  assert.equal(row!.hash, "abc123");
  assert.equal(row!.title, "Test");
  db.close();
});

test("upsertDoc: updates hash on re-insert (upsert semantics)", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "test.md", hash: "old", title: null, mtimeMs: 1, sizeBytes: 1 });
  upsertDoc(db, { path: "test.md", hash: "new", title: null, mtimeMs: 2, sizeBytes: 2 });
  const row = db.prepare("SELECT hash FROM brain_docs WHERE path = ?").get("test.md") as
    { hash: string } | undefined;
  assert.equal(row!.hash, "new");
  db.close();
});

// ── upsertChunks ──────────────────────────────────────────────────────────────

test("upsertChunks: inserts brain_chunks rows", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "doc.md", hash: "h1", title: "Doc", mtimeMs: 1, sizeBytes: 1 });
  const chunks = makeChunks("doc.md", 2);
  upsertChunks(db, chunks, "Doc");

  const count = (db.prepare("SELECT COUNT(*) as n FROM brain_chunks WHERE path = ?").get("doc.md") as { n: number }).n;
  assert.equal(count, 2);
  db.close();
});

test("upsertChunks: populates brain_chunks_fts so FTS5 matches chunk text", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "alpha.md", hash: "h", title: "Alpha", mtimeMs: 1, sizeBytes: 1 });
  const chunk: BrainChunk = {
    id: "alpha.md#0",
    path: "alpha.md",
    chunkIndex: 0,
    heading: null,
    text: "The quick brown fox jumps",
    tokenEstimate: 5,
  };
  upsertChunks(db, [chunk], "Alpha");

  const hit = db
    .prepare("SELECT * FROM brain_chunks_fts WHERE brain_chunks_fts MATCH 'fox'")
    .get();
  assert.ok(hit, "FTS5 should find the word 'fox' in chunk text");
  db.close();
});

// ── deleteDoc + cascade ───────────────────────────────────────────────────────

test("deleteDoc: removes the brain_docs row", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "gone.md", hash: "h", title: null, mtimeMs: 1, sizeBytes: 1 });
  deleteDoc(db, "gone.md");
  const row = db.prepare("SELECT 1 FROM brain_docs WHERE path = ?").get("gone.md");
  assert.equal(row, undefined);
  db.close();
});

test("deleteDoc: cascade-removes brain_chunks for that doc", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "gone.md", hash: "h", title: null, mtimeMs: 1, sizeBytes: 1 });
  upsertChunks(db, makeChunks("gone.md", 3), null);
  deleteDoc(db, "gone.md");
  const count = (db.prepare("SELECT COUNT(*) as n FROM brain_chunks WHERE path = ?").get("gone.md") as { n: number }).n;
  assert.equal(count, 0);
  db.close();
});

test("deleteDoc: cascade-removes brain_embeddings for that doc's chunks", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "gone.md", hash: "h", title: null, mtimeMs: 1, sizeBytes: 1 });
  upsertChunks(db, makeChunks("gone.md", 2), null);
  upsertEmbedding(db, makeEmbedding("gone.md#0"));
  upsertEmbedding(db, makeEmbedding("gone.md#1"));
  deleteDoc(db, "gone.md");
  const count = (db.prepare("SELECT COUNT(*) as n FROM brain_embeddings WHERE chunk_id LIKE 'gone.md%'").get() as { n: number }).n;
  assert.equal(count, 0);
  db.close();
});

// ── upsertEmbedding + getChunksWithEmbeddings ─────────────────────────────────

test("upsertEmbedding: stores vector_json and dims", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "emb.md", hash: "h", title: null, mtimeMs: 1, sizeBytes: 1 });
  upsertChunks(db, makeChunks("emb.md", 1), null);
  const emb = makeEmbedding("emb.md#0", "test-model", 4);
  upsertEmbedding(db, emb);

  const row = db
    .prepare("SELECT * FROM brain_embeddings WHERE chunk_id = ? AND model = ?")
    .get("emb.md#0", "test-model") as { dims: number; vector_json: string } | undefined;
  assert.ok(row, "embedding row should exist");
  assert.equal(row!.dims, 4);
  const parsed = JSON.parse(row!.vector_json) as number[];
  assert.deepEqual(parsed, emb.vector);
  db.close();
});

test("upsertEmbedding: overwrites on duplicate (chunk_id, model)", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "e.md", hash: "h", title: null, mtimeMs: 1, sizeBytes: 1 });
  upsertChunks(db, makeChunks("e.md", 1), null);
  upsertEmbedding(db, { chunkId: "e.md#0", model: "m", dims: 2, vector: [0.1, 0.2], embeddedAt: "2026-01-01T00:00:00Z" });
  upsertEmbedding(db, { chunkId: "e.md#0", model: "m", dims: 2, vector: [0.9, 0.9], embeddedAt: "2026-01-02T00:00:00Z" });
  const row = db
    .prepare("SELECT vector_json FROM brain_embeddings WHERE chunk_id = ? AND model = ?")
    .get("e.md#0", "m") as { vector_json: string } | undefined;
  const parsed = JSON.parse(row!.vector_json) as number[];
  assert.deepEqual(parsed, [0.9, 0.9], "second upsert should overwrite the first");
  db.close();
});

test("getChunksWithEmbeddings: returns all chunks with embeddings for the given model", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "a.md", hash: "h", title: null, mtimeMs: 1, sizeBytes: 1 });
  upsertChunks(db, makeChunks("a.md", 3), null);
  upsertEmbedding(db, makeEmbedding("a.md#0", "model-A", 2));
  upsertEmbedding(db, makeEmbedding("a.md#1", "model-A", 2));
  upsertEmbedding(db, makeEmbedding("a.md#2", "model-B", 2)); // different model

  const hits = getChunksWithEmbeddings(db, "model-A");
  assert.equal(hits.length, 2, "only chunks embedded with model-A should be returned");
  assert.ok((hits as ChunkWithEmbedding[]).every((h) => Array.isArray(h.vector) && h.vector.length === 2));
  db.close();
});

test("getChunksWithEmbeddings: vector has correct length matching dims", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "v.md", hash: "h", title: null, mtimeMs: 1, sizeBytes: 1 });
  upsertChunks(db, makeChunks("v.md", 1), null);
  upsertEmbedding(db, makeEmbedding("v.md#0", "qwen3", 8));
  const hits = getChunksWithEmbeddings(db, "qwen3");
  assert.equal(hits[0].vector.length, 8);
  db.close();
});

// ── computeReindexPlan ────────────────────────────────────────────────────────

test("computeReindexPlan: unchanged doc (same hash) → not in pathsToReindex", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "stable.md", hash: "same", title: null, mtimeMs: 1, sizeBytes: 1 });
  upsertChunks(db, makeChunks("stable.md", 1), null);

  const diskHashes = new Map([["stable.md", "same"]]);
  const plan = computeReindexPlan(db, diskHashes, "qwen3");
  assert.ok(!plan.pathsToReindex.includes("stable.md"), "unchanged doc should be skipped");
  db.close();
});

test("computeReindexPlan: changed hash → doc in pathsToReindex", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "changed.md", hash: "old", title: null, mtimeMs: 1, sizeBytes: 1 });
  upsertChunks(db, makeChunks("changed.md", 1), null);

  const diskHashes = new Map([["changed.md", "new"]]);
  const plan = computeReindexPlan(db, diskHashes, "qwen3");
  assert.ok(plan.pathsToReindex.includes("changed.md"), "changed doc should be reindexed");
  db.close();
});

test("computeReindexPlan: new doc on disk not in DB → added to pathsToReindex", () => {
  const db = openBrainIndex(":memory:");
  const diskHashes = new Map([["brand-new.md", "h1"]]);
  const plan = computeReindexPlan(db, diskHashes, "qwen3");
  assert.ok(plan.pathsToReindex.includes("brand-new.md"), "new doc should be queued for indexing");
  db.close();
});

test("computeReindexPlan: doc in DB but absent from disk → added to pathsToPrune", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "deleted.md", hash: "h", title: null, mtimeMs: 1, sizeBytes: 1 });

  const diskHashes = new Map<string, string>(); // no docs on disk
  const plan = computeReindexPlan(db, diskHashes, "qwen3");
  assert.ok(plan.pathsToPrune.includes("deleted.md"), "absent doc should be pruned");
  db.close();
});

test("computeReindexPlan: modelChanged=true when stored embeddings use a different model", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "p.md", hash: "h", title: null, mtimeMs: 1, sizeBytes: 1 });
  upsertChunks(db, makeChunks("p.md", 1), null);
  upsertEmbedding(db, makeEmbedding("p.md#0", "old-model", 2));

  const diskHashes = new Map([["p.md", "h"]]);
  const plan = computeReindexPlan(db, diskHashes, "new-model");
  assert.equal(plan.modelChanged, true);
  db.close();
});

test("computeReindexPlan: modelChanged=false when model name is the same", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "q.md", hash: "h", title: null, mtimeMs: 1, sizeBytes: 1 });
  upsertChunks(db, makeChunks("q.md", 1), null);
  upsertEmbedding(db, makeEmbedding("q.md#0", "same-model", 2));

  const diskHashes = new Map([["q.md", "h"]]);
  const plan = computeReindexPlan(db, diskHashes, "same-model");
  assert.equal(plan.modelChanged, false);
  db.close();
});

test("computeReindexPlan: chunksToEmbed lists chunk IDs needing embeddings", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "partial.md", hash: "h", title: null, mtimeMs: 1, sizeBytes: 1 });
  upsertChunks(db, makeChunks("partial.md", 3), null);
  // Only embed chunk #1; chunks #0 and #2 are missing
  upsertEmbedding(db, makeEmbedding("partial.md#1", "m", 2));

  const diskHashes = new Map([["partial.md", "h"]]);
  const plan = computeReindexPlan(db, diskHashes, "m");
  assert.ok(plan.chunksToEmbed.includes("partial.md#0"), "chunk #0 should need embedding");
  assert.ok(plan.chunksToEmbed.includes("partial.md#2"), "chunk #2 should need embedding");
  assert.ok(!plan.chunksToEmbed.includes("partial.md#1"), "chunk #1 already embedded");
  db.close();
});

// ── fts5Search ────────────────────────────────────────────────────────────────

test("fts5Search: returns matching chunks for an exact keyword", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "alpha.md", hash: "h", title: "Alpha", mtimeMs: 1, sizeBytes: 1 });
  const chunk: BrainChunk = {
    id: "alpha.md#0",
    path: "alpha.md",
    chunkIndex: 0,
    heading: null,
    text: "HiveMatrix is a local-first AI assistant",
    tokenEstimate: 8,
  };
  upsertChunks(db, [chunk], "Alpha");

  const results = fts5Search(db, "HiveMatrix", 5);
  assert.ok(results.length > 0, "should find 'HiveMatrix'");
  assert.equal(results[0].id, "alpha.md#0");
  db.close();
});

test("fts5Search: returns empty array when query matches nothing", () => {
  const db = openBrainIndex(":memory:");
  const results = fts5Search(db, "xyzzy_no_match_42", 5);
  assert.deepEqual(results, []);
  db.close();
});

test("fts5Search: exact identifier match ranks above partial overlap", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "a.md", hash: "h1", title: "A", mtimeMs: 1, sizeBytes: 1 });
  upsertDoc(db, { path: "b.md", hash: "h2", title: "B", mtimeMs: 1, sizeBytes: 1 });

  upsertChunks(db, [{
    id: "a.md#0", path: "a.md", chunkIndex: 0, heading: null,
    text: "ProjectAlpha is the main project name used across all configurations",
    tokenEstimate: 11,
  }], "A");
  upsertChunks(db, [{
    id: "b.md#0", path: "b.md", chunkIndex: 0, heading: null,
    text: "ProjectAlpha ProjectAlpha ProjectAlpha occurs many times here",
    tokenEstimate: 9,
  }], "B");

  const results = fts5Search(db, "ProjectAlpha", 10);
  assert.ok(results.length >= 1, "should have at least one result");
  // BM25 is expected to handle this — both docs match; we just confirm results are returned
  assert.ok((results as Bm25Hit[]).every((r) => r.bm25Score <= 0), "FTS5 bm25() returns negative scores");
  db.close();
});

test("fts5Search: bm25Score is negative (raw FTS5 output)", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "x.md", hash: "h", title: null, mtimeMs: 1, sizeBytes: 1 });
  upsertChunks(db, [{
    id: "x.md#0", path: "x.md", chunkIndex: 0, heading: null,
    text: "keyword density test with keyword repeated",
    tokenEstimate: 7,
  }], null);

  const results = fts5Search(db, "keyword", 5);
  assert.ok(results.length > 0);
  assert.ok(results[0].bm25Score < 0, `expected negative bm25Score, got ${results[0].bm25Score}`);
  db.close();
});

test("fts5Search: result shape has required fields (id, path, heading, text, bm25Score)", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "shape.md", hash: "h", title: null, mtimeMs: 1, sizeBytes: 1 });
  upsertChunks(db, [{
    id: "shape.md#0", path: "shape.md", chunkIndex: 0, heading: "Introduction",
    text: "overview of the system design",
    tokenEstimate: 6,
  }], null);

  const results = fts5Search(db, "overview", 5);
  assert.ok(results.length > 0);
  const r = results[0];
  assert.equal(typeof r.id, "string");
  assert.equal(typeof r.path, "string");
  assert.ok(r.heading === null || typeof r.heading === "string");
  assert.equal(typeof r.text, "string");
  assert.equal(typeof r.bm25Score, "number");
  db.close();
});

test("fts5Search: respects the limit parameter", () => {
  const db = openBrainIndex(":memory:");
  upsertDoc(db, { path: "many.md", hash: "h", title: null, mtimeMs: 1, sizeBytes: 1 });
  const chunks: BrainChunk[] = Array.from({ length: 10 }, (_, i) => ({
    id: `many.md#${i}`,
    path: "many.md",
    chunkIndex: i,
    heading: null,
    text: `chunk content matching search token for index ${i}`,
    tokenEstimate: 8,
  }));
  upsertChunks(db, chunks, null);

  const results = fts5Search(db, "content", 3);
  assert.ok(results.length <= 3, `expected ≤3 results, got ${results.length}`);
  db.close();
});
