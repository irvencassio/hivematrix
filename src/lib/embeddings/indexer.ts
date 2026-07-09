/**
 * Corpus indexer — walk the brain root, embed new/changed docs (incrementally),
 * prune removed ones, persist vectors. Cloud-stall-safe (timed reads) and bounded.
 * The embedder is injectable so the diff/index logic is testable with fake vectors.
 */

import { promises as fs } from "fs";
import { join, relative } from "path";
import { configuredBrainRootDir } from "@/lib/brain/settings";
import { embedTexts, getEmbeddingsConfig, isEmbeddingsEnabled } from "./provider";
import { loadIndex, saveIndex, planReindex, contentHash } from "./index-store";
import { startPollLoop } from "@/lib/lanes/poll-loop";
import { loadExclusions } from "@/lib/brain/exclusions";

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".html", ".htm", ".mdx"]);
// _archived is where the Brain / Memory Review screen moves archived docs
// (§4 of the design spec) — deliberately excluded from every corpus walker.
const SKIP_DIRS = new Set([".git", "node_modules", ".obsidian", ".trash", "_archived"]);
const READ_TIMEOUT_MS = 3_000;
const MAX_FILES = 5_000;
const BATCH = 32;
const MAX_EMBED_CHARS = 8_000;

export type Embedder = (texts: string[]) => Promise<number[][] | null>;

async function readTimed(path: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((r) => { timer = setTimeout(() => r(null), READ_TIMEOUT_MS); });
  const read = fs.readFile(path, "utf-8").then((c) => c as string).catch(() => null);
  try { return await Promise.race([read, timeout]); } finally { if (timer) clearTimeout(timer); }
}

interface FileRec { relPath: string; content: string; hash: string }

async function collect(root: string): Promise<FileRec[]> {
  const excluded = loadExclusions();
  const out: FileRec[] = [];
  const stack: string[] = [root];
  while (stack.length > 0 && out.length < MAX_FILES) {
    const dir = stack.pop()!;
    let entries: import("fs").Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (out.length >= MAX_FILES) break;
      if (e.isSymbolicLink()) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) stack.push(full);
      } else if (e.isFile()) {
        const dot = e.name.lastIndexOf(".");
        if (!TEXT_EXTENSIONS.has(dot >= 0 ? e.name.slice(dot).toLowerCase() : "")) continue;
        const relPath = relative(root, full);
        // Excluded from context (Brain / Memory Review, §5) — drop from the
        // semantic index too; an existing entry is pruned on the next reindex
        // since it simply falls out of collect()'s "current" file set.
        if (excluded.has(relPath)) continue;
        const content = await readTimed(full);
        if (content == null) continue;
        out.push({ relPath, content, hash: contentHash(content) });
      }
    }
  }
  return out;
}

export interface ReindexResult {
  indexed: number;
  pruned: number;
  reset: boolean;
  total: number;
  error?: string;
}

/** Bring the vector index up to date with the brain root. Never throws. */
export async function reindexBrain(opts: { embedder?: Embedder; model?: string } = {}): Promise<ReindexResult> {
  const root = configuredBrainRootDir();
  if (!root) return { indexed: 0, pruned: 0, reset: false, total: 0, error: "no brain root configured" };
  const model = opts.model ?? getEmbeddingsConfig()?.model ?? "";
  if (!model) return { indexed: 0, pruned: 0, reset: false, total: 0, error: "no embeddings model configured" };
  const embedder = opts.embedder ?? embedTexts;

  const files = await collect(root);
  let index = loadIndex();
  const plan = planReindex(files.map((f) => ({ relPath: f.relPath, hash: f.hash })), index, model);
  if (plan.reset) index = { model, entries: {} };
  index.model = model;

  for (const p of plan.toPrune) delete index.entries[p];

  const byPath = new Map(files.map((f) => [f.relPath, f]));
  let indexed = 0;
  for (let i = 0; i < plan.toEmbed.length; i += BATCH) {
    const batch = plan.toEmbed.slice(i, i + BATCH);
    const texts = batch.map((p) => (byPath.get(p)?.content ?? "").slice(0, MAX_EMBED_CHARS));
    const vectors = await embedder(texts);
    if (!vectors) {
      saveIndex(index); // persist progress so far
      return { indexed, pruned: plan.toPrune.length, reset: plan.reset, total: files.length, error: "embedder unavailable" };
    }
    for (let j = 0; j < batch.length; j++) {
      const f = byPath.get(batch[j]);
      if (f) { index.entries[batch[j]] = { hash: f.hash, vector: vectors[j] }; indexed++; }
    }
  }

  saveIndex(index);
  return { indexed, pruned: plan.toPrune.length, reset: plan.reset, total: files.length };
}

let stopFn: (() => void) | null = null;

/** Start the background reindex loop (idempotent). Self-gates on config. */
export function startEmbeddingsIndexer(): () => void {
  if (stopFn) return stopEmbeddingsIndexer;
  const cfg = getEmbeddingsConfig();
  const intervalMs = Math.max(5, cfg?.pollIntervalMinutes ?? 60) * 60_000;
  stopFn = startPollLoop({
    name: "embeddings",
    intervalMs,
    tick: async () => { if (!isEmbeddingsEnabled()) return; await reindexBrain(); },
  });
  return stopEmbeddingsIndexer;
}

export function stopEmbeddingsIndexer(): void {
  if (stopFn) { stopFn(); stopFn = null; }
}
