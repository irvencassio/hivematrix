import test from "node:test";
import assert from "node:assert/strict";
import { cosineSimilarity, mmrRerank, rankWithMmr } from "./mmr";
import type { ChunkCandidate } from "./index-db";
import type { RawBm25Hit, RawVectorHit } from "./hybrid-search";

// ── Helpers ───────────────────────────────────────────────────────────────────

function candidate(id: string, hybridScore: number): ChunkCandidate {
  return {
    id,
    path: id.split("#")[0],
    heading: null,
    text: `content for ${id}`,
    bm25Score: hybridScore,
    cosineScore: hybridScore,
    hybridScore,
  };
}

// ── cosineSimilarity ──────────────────────────────────────────────────────────

test("cosineSimilarity: identical vectors → 1.0", () => {
  const v = [1, 2, 3];
  assert.ok(Math.abs(cosineSimilarity(v, v) - 1.0) < 1e-10);
});

test("cosineSimilarity: orthogonal vectors → 0", () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-10);
});

test("cosineSimilarity: antiparallel vectors → -1", () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0], [-1, 0]) - (-1)) < 1e-10);
});

test("cosineSimilarity: zero vector → 0 (no divide-by-zero)", () => {
  assert.equal(cosineSimilarity([0, 0], [1, 2]), 0);
});

test("cosineSimilarity: both zero vectors → 0", () => {
  assert.equal(cosineSimilarity([0, 0], [0, 0]), 0);
});

test("cosineSimilarity: scaling a vector does not change similarity", () => {
  const a = [1, 2, 3];
  const b = [2, 4, 6]; // a * 2
  assert.ok(Math.abs(cosineSimilarity(a, b) - 1.0) < 1e-10);
});

// ── mmrRerank — guard conditions ──────────────────────────────────────────────

test("mmrRerank: empty input returns empty array", () => {
  assert.deepEqual(mmrRerank([], new Map()), []);
});

test("mmrRerank: single candidate is returned as-is", () => {
  const c = candidate("solo.md#0", 0.8);
  const result = mmrRerank([c], new Map([["solo.md#0", [1, 0]]]), { maxResults: 5 });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "solo.md#0");
});

test("mmrRerank: no vectors bypasses MMR, returns hybridScore order", () => {
  const candidates = [
    candidate("a.md#0", 0.9),
    candidate("b.md#0", 0.8),
    candidate("c.md#0", 0.7),
  ];
  const result = mmrRerank(candidates, new Map(), { maxResults: 3 });
  assert.deepEqual(
    result.map((c) => c.id),
    ["a.md#0", "b.md#0", "c.md#0"],
  );
});

test("mmrRerank: only one candidate has a vector — bypasses MMR", () => {
  const candidates = [candidate("a.md#0", 0.9), candidate("b.md#0", 0.8)];
  const vectorMap = new Map([["a.md#0", [1, 0]]]);
  const result = mmrRerank(candidates, vectorMap, { maxResults: 2 });
  assert.deepEqual(result.map((c) => c.id), ["a.md#0", "b.md#0"]);
});

// ── mmrRerank — correctness ───────────────────────────────────────────────────

test("mmrRerank: lambda=1.0 (pure relevance) preserves hybridScore order", () => {
  const candidates = [
    candidate("a.md#0", 0.9),
    candidate("b.md#0", 0.8),
    candidate("c.md#0", 0.5),
  ];
  // All identical vectors — without lambda dampening the similarity term, order must hold
  const vectorMap = new Map([
    ["a.md#0", [1, 0]],
    ["b.md#0", [1, 0]],
    ["c.md#0", [1, 0]],
  ]);
  const result = mmrRerank(candidates, vectorMap, { lambda: 1.0, maxResults: 3 });
  assert.deepEqual(result.map((c) => c.id), ["a.md#0", "b.md#0", "c.md#0"]);
});

test("mmrRerank: lambda=0.0 (pure diversity) picks maximally orthogonal candidates", () => {
  // Three candidates; a and b are nearly identical, c is orthogonal to both.
  // After selecting a (first pick: all have equal hybridScore so first wins),
  // pure diversity should prefer c over b.
  const candidates = [
    candidate("a.md#0", 0.8),
    candidate("b.md#0", 0.8),
    candidate("c.md#0", 0.8),
  ];
  const vectorMap = new Map<string, number[]>([
    ["a.md#0", [1, 0]],
    ["b.md#0", [1, 0]], // identical to a
    ["c.md#0", [0, 1]], // orthogonal to a
  ]);
  const result = mmrRerank(candidates, vectorMap, { lambda: 0.0, maxResults: 3 });
  assert.equal(result[0].id, "a.md#0", "first pick is first in list when scores tie");
  assert.equal(result[1].id, "c.md#0", "pure-diversity: orthogonal chunk selected second");
});

test("mmrRerank: diversifies same-document duplicate chunks", () => {
  // Two chunks from the same doc with near-identical embeddings,
  // plus one chunk from a different doc with an orthogonal embedding.
  // hybridScore order: dupA (0.9) > dupB (0.85) > diverse (0.7)
  // With balanced lambda, diverse should beat dupB for the second slot.
  const dupA    = candidate("doc.md#0",   0.9);
  const dupB    = candidate("doc.md#1",   0.85);
  const diverse = candidate("other.md#0", 0.7);

  const nearlyIdentical: number[] = [0.999, 0.045];
  const orthogonal: number[]      = [0.0,   1.0];

  const vectorMap = new Map<string, number[]>([
    ["doc.md#0",   nearlyIdentical],
    ["doc.md#1",   nearlyIdentical], // near-duplicate of doc.md#0
    ["other.md#0", orthogonal],
  ]);

  const result = mmrRerank([dupA, dupB, diverse], vectorMap, { lambda: 0.5, maxResults: 3 });

  assert.equal(result[0].id, "doc.md#0",   "first: highest hybrid scorer");
  assert.equal(result[1].id, "other.md#0", "second: diverse chunk beats near-duplicate");
  assert.equal(result[2].id, "doc.md#1",   "third: near-duplicate falls to last slot");
});

test("mmrRerank: respects maxResults cap", () => {
  const candidates = Array.from({ length: 10 }, (_, i) =>
    candidate(`doc${i}.md#0`, 1 - i * 0.1),
  );
  const vectorMap = new Map(
    candidates.map((c, i) => [c.id, [Math.cos(i * 0.5), Math.sin(i * 0.5)]]),
  );
  const result = mmrRerank(candidates, vectorMap, { maxResults: 3 });
  assert.equal(result.length, 3);
});

test("mmrRerank: candidate without a vector receives no similarity penalty", () => {
  // candidateNoVec has no embedding — its MMR score is purely lambda * hybridScore.
  // candidateWithVec has an embedding but scores lower.
  // With lambda=1 both reduce to hybridScore, so the higher-scoring one wins.
  const candidateNoVec  = candidate("novec.md#0", 0.9);
  const candidateWithVec = candidate("vec.md#0",  0.5);
  const anchor           = candidate("anchor.md#0", 1.0);
  const vectorMap = new Map<string, number[]>([
    ["anchor.md#0", [1, 0]],
    ["vec.md#0",    [1, 0]], // identical to anchor — high similarity
  ]);
  // After anchor is selected: vec.md#0 gets penalised by similarity, novec.md#0 does not.
  const result = mmrRerank([anchor, candidateNoVec, candidateWithVec], vectorMap, {
    lambda: 0.5,
    maxResults: 3,
  });
  assert.equal(result[0].id, "anchor.md#0");
  // novec (no penalty) outscores vec (high similarity penalty)
  assert.equal(result[1].id, "novec.md#0");
  assert.equal(result[2].id, "vec.md#0");
});

// ── rankWithMmr ───────────────────────────────────────────────────────────────

test("rankWithMmr: returns ChunkHit[] with required fields", () => {
  const bm25Hits: RawBm25Hit[] = [
    { id: "a.md#0", path: "a.md", heading: null, text: "alpha content", bm25Score: -5 },
    { id: "b.md#0", path: "b.md", heading: null, text: "beta content",  bm25Score: -3 },
  ];
  const vectorHits: RawVectorHit[] = [
    { id: "a.md#0", path: "a.md", heading: null, text: "alpha content", cosineScore: 0.8 },
    { id: "b.md#0", path: "b.md", heading: null, text: "beta content",  cosineScore: 0.4 },
  ];
  const vectorMap = new Map<string, number[]>([
    ["a.md#0", [1, 0]],
    ["b.md#0", [0, 1]],
  ]);
  const result = rankWithMmr(bm25Hits, vectorHits, vectorMap);
  assert.ok(result.length > 0);
  const hit = result[0];
  assert.equal(typeof hit.id, "string");
  assert.equal(typeof hit.path, "string");
  assert.ok(hit.heading === null || typeof hit.heading === "string");
  assert.equal(typeof hit.snippet, "string");
  assert.equal(typeof hit.score, "number");
  assert.ok(Array.isArray(hit.sources));
});

test("rankWithMmr: empty hits returns empty array", () => {
  const result = rankWithMmr([], [], new Map());
  assert.deepEqual(result, []);
});

test("rankWithMmr: keyword-only (no vector hits, no vectorMap) bypasses MMR", () => {
  const bm25Hits: RawBm25Hit[] = [
    { id: "x.md#0", path: "x.md", heading: null, text: "text x", bm25Score: -5 },
    { id: "y.md#0", path: "y.md", heading: null, text: "text y", bm25Score: -2 },
  ];
  const result = rankWithMmr(bm25Hits, [], new Map(), { maxResults: 2 });
  assert.equal(result.length, 2);
  assert.equal(result[0].id, "x.md#0", "highest BM25 first");
  assert.ok(result.every((h) => h.sources.includes("keyword")));
});

test("rankWithMmr: respects maxResults from opts", () => {
  const bm25Hits: RawBm25Hit[] = Array.from({ length: 8 }, (_, i) => ({
    id: `doc${i}.md#0`,
    path: `doc${i}.md`,
    heading: null,
    text: `text ${i}`,
    bm25Score: -(i + 1),
  }));
  const vectorMap = new Map(
    bm25Hits.map((h, i) => [h.id, [Math.cos(i), Math.sin(i)]]),
  );
  const result = rankWithMmr(bm25Hits, [], vectorMap, { maxResults: 3 });
  assert.equal(result.length, 3);
});
