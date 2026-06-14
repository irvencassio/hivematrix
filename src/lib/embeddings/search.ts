/**
 * Semantic + hybrid retrieval. semanticSearch ranks the corpus index by cosine
 * similarity to the query embedding. hybridBrainSearch blends keyword recall
 * (brain_search) with semantic ranking so synonyms and exact terms both win, and
 * returns the same BrainSearchResult shape so the existing formatter is reused.
 */

import { promises as fs } from "fs";
import { join } from "path";
import { configuredBrainRootDir } from "@/lib/brain/settings";
import { searchBrain, type BrainSearchResult, type BrainSearchHit } from "@/lib/brain/search";
import { isEmbeddingsEnabled, embedOne } from "./provider";
import { loadIndex, indexToItems } from "./index-store";
import { topK } from "./vector";

export interface SemanticHit { path: string; score: number; }

export async function semanticSearch(
  query: string,
  opts: { k?: number; embedder?: (q: string) => Promise<number[] | null> } = {},
): Promise<SemanticHit[]> {
  const embed = opts.embedder ?? embedOne;
  if (!opts.embedder && !isEmbeddingsEnabled()) return [];
  const qv = await embed(query);
  if (!qv) return [];
  const items = indexToItems(loadIndex());
  if (items.length === 0) return [];
  return topK(qv, items, opts.k ?? 8).map((r) => ({ path: r.id, score: r.score }));
}

export interface KeywordHit { path: string; score: number; snippet: string; }
export interface HybridHit { path: string; score: number; snippet: string; sources: string[]; }

/**
 * Pure: blend normalized keyword scores with semantic cosine (mapped to [0,1]).
 * Union by path; a path present in only one set scores 0 for the missing side.
 */
export function mergeHybrid(keyword: KeywordHit[], semantic: SemanticHit[], opts: { keywordWeight?: number } = {}): HybridHit[] {
  const kw = opts.keywordWeight ?? 0.5;
  const kwMax = Math.max(1e-9, ...keyword.map((k) => k.score));
  const kMap = new Map(keyword.map((k) => [k.path, k.score / kwMax]));
  const sMap = new Map(semantic.map((s) => [s.path, (s.score + 1) / 2])); // cosine [-1,1] → [0,1]
  const snip = new Map(keyword.map((k) => [k.path, k.snippet]));
  const out: HybridHit[] = [];
  for (const path of new Set([...kMap.keys(), ...sMap.keys()])) {
    const k = kMap.get(path) ?? 0;
    const s = sMap.get(path) ?? 0;
    const sources: string[] = [];
    if (kMap.has(path)) sources.push("keyword");
    if (sMap.has(path)) sources.push("semantic");
    out.push({ path, score: kw * k + (1 - kw) * s, snippet: snip.get(path) ?? "", sources });
  }
  return out.sort((a, b) => b.score - a.score);
}

async function snippetFor(relPath: string, chars = 300): Promise<string> {
  const root = configuredBrainRootDir();
  if (!root) return "";
  try {
    const raw = await Promise.race([
      fs.readFile(join(root, relPath), "utf-8").then((c) => c as string).catch(() => ""),
      new Promise<string>((r) => setTimeout(() => r(""), 2_000)),
    ]);
    return raw.slice(0, chars).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

/**
 * Hybrid retrieval: keyword recall + semantic rank, merged. Falls back to plain
 * keyword when embeddings are disabled or the query can't be embedded. Returns a
 * BrainSearchResult so callers/formatters are unchanged.
 */
export async function hybridBrainSearch(
  query: string,
  opts: { maxResults?: number; embedder?: (q: string) => Promise<number[] | null> } = {},
): Promise<BrainSearchResult> {
  const maxResults = opts.maxResults ?? 5;
  // Keyword recall (wider, so semantic has candidates to lift), then keep top N.
  const keywordResult = await searchBrain(query, { maxResults: Math.max(maxResults, 15) });
  const semantic = await semanticSearch(query, { k: Math.max(maxResults, 15), embedder: opts.embedder });
  if (semantic.length === 0) {
    return { ...keywordResult, hits: keywordResult.hits.slice(0, maxResults) };
  }

  const merged = mergeHybrid(
    keywordResult.hits.map((h) => ({ path: h.path, score: h.score, snippet: h.snippet })),
    semantic,
  ).slice(0, maxResults);

  // Backfill snippets for semantic-only hits (they have no keyword snippet).
  const hits: BrainSearchHit[] = [];
  for (const m of merged) {
    const snippet = m.snippet || (await snippetFor(m.path));
    hits.push({ path: m.path, score: Math.round(m.score * 1000) / 1000, snippet });
  }

  return {
    root: keywordResult.root,
    query,
    terms: keywordResult.terms,
    hits,
    filesScanned: keywordResult.filesScanned,
    truncated: keywordResult.truncated,
  };
}
