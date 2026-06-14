/**
 * Corpus vector index — a sidecar JSON under ~/.hivematrix keyed by brain-relative
 * path + content hash, so reindexing is incremental (only changed/new docs are
 * re-embedded) and a model change invalidates everything. No vector DB.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import { homedir } from "os";
import { join } from "path";

export interface IndexEntry {
  hash: string;
  vector: number[];
}

export interface IndexFile {
  model: string;
  entries: Record<string, IndexEntry>;
}

function indexPath(): string {
  const dir = join(homedir(), ".hivematrix");
  mkdirSync(dir, { recursive: true });
  return join(dir, "embeddings-index.json");
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function loadIndex(): IndexFile {
  try {
    const raw = JSON.parse(readFileSync(indexPath(), "utf-8"));
    return {
      model: typeof raw.model === "string" ? raw.model : "",
      entries: raw.entries && typeof raw.entries === "object" ? raw.entries : {},
    };
  } catch {
    return { model: "", entries: {} };
  }
}

export function saveIndex(index: IndexFile): void {
  writeFileSync(indexPath(), JSON.stringify(index));
}

export interface ReindexPlan {
  toEmbed: string[];
  toPrune: string[];
  reset: boolean;
}

/**
 * Pure: decide what to (re)embed and prune. A model change resets everything
 * (vectors from different models aren't comparable). New or content-changed files
 * are re-embedded; files gone from disk are pruned.
 */
export function planReindex(files: Array<{ relPath: string; hash: string }>, index: IndexFile, model: string): ReindexPlan {
  const reset = index.model !== "" && index.model !== model;
  const current = new Set(files.map((f) => f.relPath));
  const toEmbed: string[] = [];
  for (const f of files) {
    const e = index.entries[f.relPath];
    if (reset || !e || e.hash !== f.hash) toEmbed.push(f.relPath);
  }
  const toPrune = reset ? [] : Object.keys(index.entries).filter((p) => !current.has(p));
  return { toEmbed, toPrune, reset };
}

export function indexToItems(index: IndexFile): Array<{ id: string; vector: number[] }> {
  return Object.entries(index.entries).map(([id, e]) => ({ id, vector: e.vector }));
}
