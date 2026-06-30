/**
 * Hybrid ranking: merge FTS5/BM25 keyword hits with cosine-similarity vector hits
 * into a single ranked list. All scoring is pure — no I/O, no SQLite deps here.
 * Callers (to be wired up in index-db.ts) supply the raw hit lists.
 *
 * Algorithm:
 *   1. Normalize BM25 scores from FTS5 (negative → positive) to [0, 1].
 *   2. Normalize cosine scores from [-1, 1] to [0, 1].
 *   3. Union by chunk ID; missing-side score = 0.
 *   4. hybridScore = textWeight * bm25Score + vectorWeight * cosineScore.
 *   5. Sort descending; slice to maxResults; emit ChunkHit[].
 */

import type { ChunkCandidate, ChunkHit } from "./index-db";

/** Raw BM25 hit from FTS5: bm25Score is the raw bm25() output (negative). */
export interface RawBm25Hit {
  id: string;
  path: string;
  heading: string | null;
  text: string;
  bm25Score: number; // FTS5 bm25() — negative; more negative = more relevant
}

/** Raw vector hit: cosineScore is cosine similarity in [-1, 1]. */
export interface RawVectorHit {
  id: string;
  path: string;
  heading: string | null;
  text: string;
  cosineScore: number; // cosine similarity in [-1, 1]
}

export interface HybridMergeOpts {
  textWeight?: number;   // BM25 weight, default 0.45
  vectorWeight?: number; // cosine weight, default 0.55
}

/**
 * Normalize a list of non-negative scores to [0, 1] by dividing each by the max.
 * All-zero returns all-zero. Empty returns empty.
 */
export function normalizeToUnit(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const max = Math.max(...scores);
  if (max === 0) return scores.map(() => 0);
  return scores.map((s) => s / max);
}

/**
 * Convert FTS5 bm25() raw (negative) scores to [0, 1].
 * FTS5 returns more-negative = more relevant; negate, then normalize.
 */
export function normalizeBm25(rawScores: number[]): number[] {
  return normalizeToUnit(rawScores.map((s) => -s));
}

/**
 * Map cosine similarity from [-1, 1] to [0, 1] via (x + 1) / 2.
 * Preserves relative ordering; models that produce [0, 1] already still rank correctly.
 */
export function normalizeCosine(cosineScores: number[]): number[] {
  return cosineScores.map((s) => (s + 1) / 2);
}

/**
 * Merge BM25 keyword hits and vector semantic hits by chunk ID.
 *
 * Both score sets are normalized to [0, 1] before merging. Chunks absent from
 * one source receive 0 for that source. Returns candidates sorted descending
 * by hybridScore.
 */
export function hybridMerge(
  bm25Hits: RawBm25Hit[],
  vectorHits: RawVectorHit[],
  opts: HybridMergeOpts = {},
): ChunkCandidate[] {
  const textWeight = opts.textWeight ?? 0.45;
  const vectorWeight = opts.vectorWeight ?? 0.55;

  const bm25Norm = normalizeBm25(bm25Hits.map((h) => h.bm25Score));
  const cosineNorm = normalizeCosine(vectorHits.map((h) => h.cosineScore));

  type Meta = { path: string; heading: string | null; text: string };
  const bm25Map = new Map<string, { score: number } & Meta>();
  bm25Hits.forEach((h, i) => {
    bm25Map.set(h.id, { score: bm25Norm[i], path: h.path, heading: h.heading, text: h.text });
  });

  const vectorMap = new Map<string, { score: number } & Meta>();
  vectorHits.forEach((h, i) => {
    vectorMap.set(h.id, { score: cosineNorm[i], path: h.path, heading: h.heading, text: h.text });
  });

  const allIds = new Set([...bm25Map.keys(), ...vectorMap.keys()]);
  const candidates: ChunkCandidate[] = [];

  for (const id of allIds) {
    const b = bm25Map.get(id);
    const v = vectorMap.get(id);
    const meta = (b ?? v)!;
    const bm25Score = b?.score ?? 0;
    const cosineScore = v?.score ?? 0;
    candidates.push({
      id,
      path: meta.path,
      heading: meta.heading,
      text: meta.text,
      bm25Score,
      cosineScore,
      hybridScore: textWeight * bm25Score + vectorWeight * cosineScore,
    });
  }

  return candidates.sort((a, b) => b.hybridScore - a.hybridScore);
}

/**
 * Convert a ranked ChunkCandidate to a ChunkHit for callers and formatters.
 * snippet: first 300 chars of text, whitespace-normalized.
 * score: hybridScore rounded to 3 decimal places.
 */
export function buildChunkHit(
  candidate: ChunkCandidate,
  bm25Ids: ReadonlySet<string>,
  vectorIds: ReadonlySet<string>,
): ChunkHit {
  const snippet = candidate.text.slice(0, 300).replace(/\s+/g, " ").trim();
  const sources: Array<"keyword" | "semantic"> = [];
  if (bm25Ids.has(candidate.id)) sources.push("keyword");
  if (vectorIds.has(candidate.id)) sources.push("semantic");
  return {
    id: candidate.id,
    path: candidate.path,
    heading: candidate.heading,
    snippet,
    score: Math.round(candidate.hybridScore * 1000) / 1000,
    sources,
  };
}

/**
 * Full hybrid ranking pipeline: merge → cap → emit ChunkHit[].
 * Keyword-only mode works when vectorHits is empty (or weights are textWeight=1, vectorWeight=0).
 */
export function rankHybrid(
  bm25Hits: RawBm25Hit[],
  vectorHits: RawVectorHit[],
  opts: HybridMergeOpts & { maxResults?: number } = {},
): ChunkHit[] {
  const maxResults = opts.maxResults ?? 10;
  const candidates = hybridMerge(bm25Hits, vectorHits, opts);
  const bm25Ids = new Set(bm25Hits.map((h) => h.id));
  const vectorIds = new Set(vectorHits.map((h) => h.id));
  return candidates
    .slice(0, maxResults)
    .map((c) => buildChunkHit(c, bm25Ids, vectorIds));
}
