/**
 * brain_search — keyword retrieval over the brain root so stored documents are
 * findable by relevance, not only by a pinned path. This is the "store a
 * document for lookup later" capability: the memory bundle (memory-bundle.ts)
 * front-loads a few pinned docs; this lets an agent actively go find any doc.
 *
 * No vector DB / embeddings (yet) — a bounded keyword scan with term-frequency
 * scoring and a snippet. It honours the same cloud-stall discipline as the rest
 * of the brain module: async, per-file-timed reads (the root commonly lives on a
 * dehydrating Google Drive mount) plus a hard wall-clock budget so a stalled
 * Drive never hangs the daemon — it returns partial results and says so.
 */

import { promises as fs } from "fs";
import { join, relative } from "path";
import { configuredBrainRootDir } from "./settings";

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".html", ".htm", ".mdx"]);
const SKIP_DIRS = new Set([".git", "node_modules", ".obsidian", ".trash", "_archived"]);
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are",
  "with", "how", "what", "find", "doc", "docs", "about", "my", "me", "do",
]);

export interface BrainSearchHit {
  /** Path relative to the brain root. */
  path: string;
  score: number;
  snippet: string;
}

export interface BrainSearchResult {
  root: string | null;
  query: string;
  terms: string[];
  hits: BrainSearchHit[];
  filesScanned: number;
  truncated: boolean;
  reason?: string;
}

export interface BrainSearchOptions {
  root?: string | null;
  maxResults?: number;
  maxFilesScanned?: number;
  perFileTimeoutMs?: number;
  totalBudgetMs?: number;
  snippetChars?: number;
  now?: () => number;
}

export function tokenizeQuery(query: string): string[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
  return [...new Set(terms)];
}

async function readWithTimeout(path: string, timeoutMs: number): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  const read = fs.readFile(path, "utf-8").then((c) => c as string).catch(() => null);
  try {
    return await Promise.race([read, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Count non-overlapping occurrences of `term` in `haystack` (already lowercased). */
function countOccurrences(haystack: string, term: string): number {
  let count = 0;
  let idx = haystack.indexOf(term);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(term, idx + term.length);
  }
  return count;
}

function buildSnippet(content: string, lowerContent: string, terms: string[], snippetChars: number): string {
  let firstHit = -1;
  for (const t of terms) {
    const i = lowerContent.indexOf(t);
    if (i !== -1 && (firstHit === -1 || i < firstHit)) firstHit = i;
  }
  if (firstHit === -1) return content.slice(0, snippetChars).replace(/\s+/g, " ").trim();
  const start = Math.max(0, firstHit - Math.floor(snippetChars / 3));
  const raw = content.slice(start, start + snippetChars).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${raw}${start + snippetChars < content.length ? "…" : ""}`;
}

/** Recursively collect candidate text-file paths (bounded by maxFiles). */
async function collectFiles(root: string, maxFiles: number): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0 && out.length < maxFiles) {
    const dir = stack.pop()!;
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir — skip
    }
    for (const e of entries) {
      if (out.length >= maxFiles) break;
      // Never follow symlinks — a link inside the brain root must not let a
      // search read or escape to files outside it. (withFileTypes already reports
      // a symlink as neither file nor dir; this is explicit defense-in-depth.)
      if (e.isSymbolicLink()) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) stack.push(full);
      } else if (e.isFile()) {
        const dot = e.name.lastIndexOf(".");
        const ext = dot >= 0 ? e.name.slice(dot).toLowerCase() : "";
        if (TEXT_EXTENSIONS.has(ext)) out.push(full);
      }
    }
  }
  return out;
}

/**
 * Search the brain root for documents matching `query`. Filename matches are
 * weighted heavily (and read first); content is term-frequency scored. Returns
 * the top hits with snippets, plus whether the scan was truncated by a budget.
 */
export async function searchBrain(query: string, opts: BrainSearchOptions = {}): Promise<BrainSearchResult> {
  const root = opts.root !== undefined ? opts.root : configuredBrainRootDir();
  const maxResults = opts.maxResults ?? 5;
  const maxFilesScanned = opts.maxFilesScanned ?? 400;
  const perFileTimeoutMs = opts.perFileTimeoutMs ?? 1_500;
  const totalBudgetMs = opts.totalBudgetMs ?? 8_000;
  const snippetChars = opts.snippetChars ?? 300;
  const now = opts.now ?? Date.now;
  const terms = tokenizeQuery(query);

  if (!root) return { root: null, query, terms, hits: [], filesScanned: 0, truncated: false, reason: "brain memory is disabled or no brain root is configured" };
  if (terms.length === 0) return { root, query, terms, hits: [], filesScanned: 0, truncated: false, reason: "query had no searchable terms" };

  const files = await collectFiles(root, maxFilesScanned * 2);
  // Filename score first (cheap), so the most likely matches are read within budget.
  const FILENAME_WEIGHT = 5;
  const ranked = files
    .map((path) => {
      const rel = relative(root, path).toLowerCase();
      const fnScore = terms.reduce((s, t) => s + (rel.includes(t) ? 1 : 0), 0);
      return { path, fnScore };
    })
    .sort((a, b) => b.fnScore - a.fnScore);

  const start = now();
  const hits: BrainSearchHit[] = [];
  let filesScanned = 0;
  let truncated = false;

  for (const { path, fnScore } of ranked) {
    if (filesScanned >= maxFilesScanned || now() - start > totalBudgetMs) {
      truncated = ranked.length > filesScanned;
      break;
    }
    const content = await readWithTimeout(path, perFileTimeoutMs);
    filesScanned++;
    if (content == null) continue; // unreadable or timed out (cloud stall)
    const lower = content.toLowerCase();
    const contentScore = terms.reduce((s, t) => s + Math.min(countOccurrences(lower, t), 20), 0);
    const score = fnScore * FILENAME_WEIGHT + contentScore;
    if (score <= 0) continue;
    hits.push({ path: relative(root, path), score, snippet: buildSnippet(content, lower, terms, snippetChars) });
  }

  hits.sort((a, b) => b.score - a.score);
  return { root, query, terms, hits: hits.slice(0, maxResults), filesScanned, truncated };
}

/** Render a search result as the string an agent tool returns. */
export function formatBrainSearchResult(result: BrainSearchResult): string {
  if (!result.root) return `Error: ${result.reason ?? "brain root unavailable"}.`;
  if (result.terms.length === 0) return `Error: ${result.reason ?? "no searchable terms in the query"}.`;
  if (result.hits.length === 0) {
    return `No brain docs matched "${result.query}" (scanned ${result.filesScanned} files under the brain root)${result.truncated ? " — scan was truncated by the time budget, try a narrower query" : ""}.`;
  }
  const lines = result.hits.map((h, i) => `${i + 1}. ${h.path} (score ${h.score})\n   ${h.snippet}`);
  const note = result.truncated ? `\n\n(Scan truncated by the time budget after ${result.filesScanned} files — results may be incomplete.)` : "";
  return `Found ${result.hits.length} brain doc(s) for "${result.query}":\n${lines.join("\n")}${note}`;
}
