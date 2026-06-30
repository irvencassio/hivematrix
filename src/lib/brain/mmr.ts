/**
 * Maximal Marginal Relevance (MMR) reranking for hybrid brain search results.
 *
 * MMR balances relevance and diversity by greedily selecting the candidate that
 * maximises:
 *   lambda * hybridScore - (1 - lambda) * maxCosineSimilarityToAlreadySelected
 *
 * Guard: if fewer than 2 candidates have vectors, MMR is bypassed and candidates
 * are returned in their original (hybridScore-descending) order.
 *
 * Reference:
 *   Carbonell & Goldstein, 1998 — "The Use of MMR, Diversity-Based Reranking
 *   for Reordering Documents and Producing Summaries"
 */

import type { ChunkCandidate, ChunkHit } from "./index-db";
import { buildChunkHit, hybridMerge } from "./hybrid-search";
import type { RawBm25Hit, RawVectorHit, HybridMergeOpts } from "./hybrid-search";

export interface MmrOpts {
  lambda?: number;     // 0..1; default 0.7; 1.0 = pure relevance, 0.0 = pure diversity
  maxResults?: number; // cap on final result count; default 10
}

/**
 * Cosine similarity between two equal-length float vectors.
 * Returns 0 if either vector has zero magnitude.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Greedy MMR selection over a list of hybrid-scored candidates.
 *
 * @param candidates - Sorted descending by hybridScore (output of hybridMerge).
 * @param vectorMap  - chunk id → embedding vector; only chunks present here
 *                     contribute to diversity scoring.
 * @param opts       - lambda (default 0.7) and maxResults (default 10).
 *
 * When fewer than 2 candidates have vectors, returns the first maxResults
 * candidates in their original order (hybridScore-only ranking).
 *
 * Candidates absent from vectorMap receive a maxSimilarity of 0, so they
 * float on hybridScore alone without any diversity penalty or benefit.
 */
export function mmrRerank(
  candidates: ChunkCandidate[],
  vectorMap: ReadonlyMap<string, number[]>,
  opts: MmrOpts = {},
): ChunkCandidate[] {
  const lambda = opts.lambda ?? 0.7;
  const maxResults = opts.maxResults ?? 10;

  if (candidates.length === 0) return [];

  const withVectors = candidates.filter((c) => vectorMap.has(c.id));
  if (withVectors.length < 2) {
    return candidates.slice(0, maxResults);
  }

  const remaining = [...candidates];
  const selected: ChunkCandidate[] = [];

  while (selected.length < maxResults && remaining.length > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      const cv = vectorMap.get(c.id);

      let maxSim = 0;
      if (cv !== undefined && selected.length > 0) {
        for (const s of selected) {
          const sv = vectorMap.get(s.id);
          if (sv !== undefined) {
            const sim = cosineSimilarity(cv, sv);
            if (sim > maxSim) maxSim = sim;
          }
        }
      }

      const mmrScore = lambda * c.hybridScore - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;
    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}

/**
 * Full pipeline with MMR: hybrid merge → MMR rerank → ChunkHit[].
 *
 * Pass vectorMap built from the stored embeddings fetched during the vector
 * search pass. When the map has fewer than 2 entries, MMR is bypassed.
 */
export function rankWithMmr(
  bm25Hits: RawBm25Hit[],
  vectorHits: RawVectorHit[],
  vectorMap: ReadonlyMap<string, number[]>,
  opts: HybridMergeOpts & MmrOpts = {},
): ChunkHit[] {
  const candidates = hybridMerge(bm25Hits, vectorHits, opts);
  const reranked = mmrRerank(candidates, vectorMap, opts);
  const bm25Ids = new Set(bm25Hits.map((h) => h.id));
  const vectorIds = new Set(vectorHits.map((h) => h.id));
  return reranked.map((c) => buildChunkHit(c, bm25Ids, vectorIds));
}
