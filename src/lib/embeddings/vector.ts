/**
 * Vector math for semantic retrieval. Pure, dependency-free — a personal brain is
 * a few hundred–few thousand docs, so brute-force cosine in JS is microseconds and
 * we avoid a native vector-DB dependency (consistent with the lean dep list).
 */

export function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function magnitude(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

/** Cosine similarity in [-1, 1]; 0 when either vector is empty/zero. */
export function cosineSimilarity(a: number[], b: number[]): number {
  const m = magnitude(a) * magnitude(b);
  return m === 0 ? 0 : dot(a, b) / m;
}

export interface VectorItem<T = string> {
  id: T;
  vector: number[];
}

export interface RankedItem<T = string> {
  id: T;
  score: number;
}

/** Rank items by cosine similarity to the query, descending, top k. */
export function topK<T>(query: number[], items: VectorItem<T>[], k: number): RankedItem<T>[] {
  return items
    .map((it) => ({ id: it.id, score: cosineSimilarity(query, it.vector) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, Math.max(0, k));
}
