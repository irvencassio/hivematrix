import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeToUnit,
  normalizeBm25,
  normalizeCosine,
  hybridMerge,
  buildChunkHit,
  rankHybrid,
  type RawBm25Hit,
  type RawVectorHit,
} from "./hybrid-search";

// ── Helpers ──────────────────────────────────────────────────────────────────

const bm25 = (id: string, score: number): RawBm25Hit => ({
  id,
  path: id.split("#")[0],
  heading: null,
  text: `content for ${id}`,
  bm25Score: score,
});

const vec = (id: string, score: number): RawVectorHit => ({
  id,
  path: id.split("#")[0],
  heading: null,
  text: `content for ${id}`,
  cosineScore: score,
});

// ── normalizeToUnit ───────────────────────────────────────────────────────────

test("normalizeToUnit: maps max to 1.0 and scales others proportionally", () => {
  const result = normalizeToUnit([4, 2, 1]);
  assert.deepEqual(result, [1.0, 0.5, 0.25]);
});

test("normalizeToUnit: empty input returns empty array", () => {
  assert.deepEqual(normalizeToUnit([]), []);
});

test("normalizeToUnit: all-zero input returns all zeros", () => {
  assert.deepEqual(normalizeToUnit([0, 0, 0]), [0, 0, 0]);
});

test("normalizeToUnit: single element normalizes to 1.0", () => {
  assert.deepEqual(normalizeToUnit([7]), [1.0]);
});

// ── normalizeBm25 ─────────────────────────────────────────────────────────────

test("normalizeBm25: most-negative FTS5 score becomes 1.0 (most relevant)", () => {
  const result = normalizeBm25([-5, -2, -1]);
  assert.equal(result[0], 1.0, "most negative → most relevant → 1.0");
  assert.ok(result[1] < result[0], "second is less relevant");
  assert.ok(result[2] < result[1], "third is least relevant");
});

test("normalizeBm25: single score normalizes to 1.0", () => {
  assert.deepEqual(normalizeBm25([-3.7]), [1.0]);
});

// ── normalizeCosine ───────────────────────────────────────────────────────────

test("normalizeCosine: maps [-1, 0, 1] cosine to [0, 0.5, 1]", () => {
  const result = normalizeCosine([1.0, 0.0, -1.0]);
  assert.deepEqual(result, [1.0, 0.5, 0.0]);
});

// ── hybridMerge ───────────────────────────────────────────────────────────────

test("hybridMerge: BM25-only hit gets cosineScore=0 and hybridScore = textWeight*1.0", () => {
  const result = hybridMerge([bm25("a.md#0", -5)], []);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "a.md#0");
  assert.equal(result[0].cosineScore, 0);
  // single BM25 hit normalizes to 1.0; hybridScore = 0.45 * 1.0
  assert.ok(Math.abs(result[0].hybridScore - 0.45) < 1e-10);
});

test("hybridMerge: vector-only hit gets bm25Score=0 and hybridScore = vectorWeight*cosineNorm", () => {
  const result = hybridMerge([], [vec("b.md#0", 0.8)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].bm25Score, 0);
  const expectedCosine = (0.8 + 1) / 2; // 0.9
  const expectedHybrid = 0.55 * expectedCosine;
  assert.ok(Math.abs(result[0].cosineScore - expectedCosine) < 1e-10);
  assert.ok(Math.abs(result[0].hybridScore - expectedHybrid) < 1e-10);
});

test("hybridMerge: chunk in both sources gets weighted sum of normalized scores", () => {
  const shared = "shared.md#0";
  const result = hybridMerge([bm25(shared, -5)], [vec(shared, 0.6)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].bm25Score, 1.0); // single candidate → normalized to 1.0
  const expectedCosine = (0.6 + 1) / 2; // 0.8
  assert.ok(Math.abs(result[0].cosineScore - expectedCosine) < 1e-10);
  const expectedHybrid = 0.45 * 1.0 + 0.55 * expectedCosine;
  assert.ok(Math.abs(result[0].hybridScore - expectedHybrid) < 1e-10);
});

test("hybridMerge: unions all IDs from both source sets", () => {
  const result = hybridMerge(
    [bm25("a.md#0", -3), bm25("b.md#0", -1)],
    [vec("c.md#0", 0.9), vec("b.md#0", 0.5)],
  );
  const ids = result.map((r) => r.id).sort();
  assert.deepEqual(ids, ["a.md#0", "b.md#0", "c.md#0"]);
});

test("hybridMerge: sorted descending by hybridScore", () => {
  const result = hybridMerge(
    [bm25("low.md#0", -1), bm25("high.md#0", -10)],
    [],
  );
  assert.equal(result[0].id, "high.md#0", "most relevant BM25 comes first");
  assert.ok(result[0].hybridScore >= result[1].hybridScore);
});

test("hybridMerge: custom textWeight=1.0 vectorWeight=0.0 yields pure BM25 score", () => {
  const result = hybridMerge(
    [bm25("x.md#0", -5)],
    [vec("x.md#0", 0.0)],
    { textWeight: 1.0, vectorWeight: 0.0 },
  );
  assert.ok(Math.abs(result[0].hybridScore - 1.0) < 1e-10);
});

test("hybridMerge: custom textWeight=0.0 vectorWeight=1.0 yields pure cosine score", () => {
  const cosine = 0.6; // normalized → 0.8
  const result = hybridMerge(
    [vec("y.md#0", cosine)].map((v) => ({ ...v, bm25Score: 0 }) as RawBm25Hit),
    [vec("y.md#0", cosine)],
    { textWeight: 0.0, vectorWeight: 1.0 },
  );
  const expectedCosine = (cosine + 1) / 2;
  assert.ok(Math.abs(result[0].hybridScore - expectedCosine) < 1e-10);
});

test("hybridMerge: empty inputs return empty array", () => {
  assert.deepEqual(hybridMerge([], []), []);
});

test("hybridMerge: preserves path and heading from the source hit", () => {
  const hit: RawBm25Hit = {
    id: "projects/hive.md#2",
    path: "projects/hive.md",
    heading: "Known Issues",
    text: "Some content",
    bm25Score: -3,
  };
  const result = hybridMerge([hit], []);
  assert.equal(result[0].path, "projects/hive.md");
  assert.equal(result[0].heading, "Known Issues");
});

// ── buildChunkHit ─────────────────────────────────────────────────────────────

test("buildChunkHit: snippet is at most 300 chars with normalized whitespace", () => {
  const candidate = {
    id: "a.md#0",
    path: "a.md",
    heading: null,
    text: "word ".repeat(100), // 500 chars
    bm25Score: 1,
    cosineScore: 0.5,
    hybridScore: 0.725,
  };
  const hit = buildChunkHit(candidate, new Set(["a.md#0"]), new Set());
  assert.ok(hit.snippet.length <= 300, "snippet ≤ 300 chars");
  assert.doesNotMatch(hit.snippet, /\s{2,}/, "no double spaces");
});

test("buildChunkHit: score rounded to 3 decimal places", () => {
  const candidate = {
    id: "a.md#0",
    path: "a.md",
    heading: null,
    text: "text",
    bm25Score: 0,
    cosineScore: 0,
    hybridScore: 0.456789,
  };
  const hit = buildChunkHit(candidate, new Set(), new Set());
  assert.equal(hit.score, 0.457);
});

test("buildChunkHit: sources=['keyword'] when only in BM25 set", () => {
  const candidate = {
    id: "a.md#0",
    path: "a.md",
    heading: null,
    text: "text",
    bm25Score: 1,
    cosineScore: 0,
    hybridScore: 0.45,
  };
  const hit = buildChunkHit(candidate, new Set(["a.md#0"]), new Set());
  assert.deepEqual(hit.sources, ["keyword"]);
});

test("buildChunkHit: sources=['semantic'] when only in vector set", () => {
  const candidate = {
    id: "a.md#0",
    path: "a.md",
    heading: null,
    text: "text",
    bm25Score: 0,
    cosineScore: 0.9,
    hybridScore: 0.495,
  };
  const hit = buildChunkHit(candidate, new Set(), new Set(["a.md#0"]));
  assert.deepEqual(hit.sources, ["semantic"]);
});

test("buildChunkHit: sources=['keyword','semantic'] when present in both", () => {
  const candidate = {
    id: "a.md#0",
    path: "a.md",
    heading: null,
    text: "text",
    bm25Score: 0.5,
    cosineScore: 0.5,
    hybridScore: 0.5,
  };
  const hit = buildChunkHit(candidate, new Set(["a.md#0"]), new Set(["a.md#0"]));
  assert.deepEqual(hit.sources, ["keyword", "semantic"]);
});

test("buildChunkHit: preserves heading (may be null)", () => {
  const candidate = {
    id: "a.md#0",
    path: "a.md",
    heading: "Introduction",
    text: "text",
    bm25Score: 1,
    cosineScore: 0,
    hybridScore: 0.45,
  };
  const hit = buildChunkHit(candidate, new Set(["a.md#0"]), new Set());
  assert.equal(hit.heading, "Introduction");
});

// ── rankHybrid ────────────────────────────────────────────────────────────────

test("rankHybrid: caps results at maxResults", () => {
  const hits: RawBm25Hit[] = Array.from({ length: 20 }, (_, i) =>
    bm25(`doc${i}.md#0`, -(i + 1)),
  );
  const result = rankHybrid(hits, [], { maxResults: 5 });
  assert.equal(result.length, 5);
});

test("rankHybrid: keyword-only mode, all results have sources=['keyword']", () => {
  const hits: RawBm25Hit[] = [bm25("a.md#0", -10), bm25("b.md#0", -2)];
  const result = rankHybrid(hits, [], { textWeight: 1.0, vectorWeight: 0.0 });
  assert.equal(result[0].id, "a.md#0", "most relevant BM25 hit is first");
  assert.ok(result.every((h) => h.sources.includes("keyword")));
  assert.ok(result.every((h) => !h.sources.includes("semantic")));
});

test("rankHybrid: pure-vector hit with high cosine outranks pure-BM25 at default weights", () => {
  // strong-kw: bm25=1.0, cosine=0  → hybrid = 0.45*1.0 = 0.45
  // strong-vec: bm25=0,  cosine=0.995 → hybrid = 0.55*(0.995+1)/2 ≈ 0.548
  const result = rankHybrid(
    [bm25("strong-kw.md#0", -10)],
    [vec("strong-vec.md#0", 0.99)],
  );
  assert.equal(result[0].id, "strong-vec.md#0");
});

test("rankHybrid: returns ChunkHit shapes with required fields", () => {
  const result = rankHybrid([bm25("x.md#1", -3)], []);
  assert.equal(result.length, 1);
  const hit = result[0];
  assert.equal(typeof hit.id, "string");
  assert.equal(typeof hit.path, "string");
  assert.equal(typeof hit.snippet, "string");
  assert.equal(typeof hit.score, "number");
  assert.ok(Array.isArray(hit.sources));
});
