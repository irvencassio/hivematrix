/**
 * Brain corpus hygiene — surface stale and duplicate/near-duplicate docs so the
 * operator can prune or merge. The audit flagged that only playbooks get deduped;
 * this covers the whole `<brain>` corpus. Deterministic (no LLM): stale = not
 * touched in N days; duplicates = identical or high-Jaccard normalized content.
 * Pure core + a bounded, Drive-stall-safe reader.
 */

import { promises as fs } from "fs";
import { join } from "path";
import { configuredBrainRootDir } from "@/lib/brain/settings";

export interface BrainDoc { path: string; content: string; mtimeMs: number }

/** Normalize for comparison: strip frontmatter/markup noise, lowercase, collapse ws. */
export function normalizeContent(s: string): string {
  return s
    .replace(/^---\n[\s\S]*?\n---\n/, " ")   // drop YAML frontmatter
    .replace(/<[^>]+>/g, " ")                 // strip HTML tags
    .replace(/[#*`_>\-|[\]()]/g, " ")         // strip common markdown punctuation
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function wordSet(normalized: string): Set<string> {
  return new Set(normalized.split(" ").filter((w) => w.length > 2));
}

/** Jaccard similarity of two word sets (0..1). Pure. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export interface DuplicateGroup { kind: "exact" | "near"; similarity: number; docs: string[] }

/** Pairs of docs that are identical or near-identical (Jaccard ≥ threshold). Pure. */
export function findDuplicates(docs: BrainDoc[], opts: { threshold?: number } = {}): DuplicateGroup[] {
  const threshold = opts.threshold ?? 0.85;
  const norm = docs.map((d) => ({ path: d.path, n: normalizeContent(d.content) }));
  const sets = norm.map((d) => wordSet(d.n));
  const groups: DuplicateGroup[] = [];
  for (let i = 0; i < norm.length; i++) {
    for (let j = i + 1; j < norm.length; j++) {
      if (norm[i].n && norm[i].n === norm[j].n) {
        groups.push({ kind: "exact", similarity: 1, docs: [norm[i].path, norm[j].path] });
        continue;
      }
      const sim = jaccard(sets[i], sets[j]);
      if (sim >= threshold) groups.push({ kind: "near", similarity: Math.round(sim * 100) / 100, docs: [norm[i].path, norm[j].path] });
    }
  }
  return groups.sort((a, b) => b.similarity - a.similarity);
}

export interface StaleDoc { path: string; ageDays: number }

/** Docs not modified within `staleDays`, most-stale first. Pure. */
export function findStale(docs: BrainDoc[], opts: { now?: number; staleDays?: number } = {}): StaleDoc[] {
  const now = opts.now ?? Date.now();
  const staleDays = opts.staleDays ?? 180;
  return docs
    .map((d) => ({ path: d.path, ageDays: Math.floor((now - d.mtimeMs) / 86_400_000) }))
    .filter((d) => d.ageDays >= staleDays)
    .sort((a, b) => b.ageDays - a.ageDays);
}

// --- bounded, Drive-stall-safe corpus reader -------------------------------

const READ_TIMEOUT_MS = 3_000;
const MAX_DOCS = 300;

async function listDir(path: string, dirsOnly: boolean): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((r) => { timer = setTimeout(() => r(null), READ_TIMEOUT_MS); });
  const read = fs.readdir(path, { withFileTypes: true })
    .then((es) => es.filter((e) => (dirsOnly ? e.isDirectory() : e.isFile())).map((e) => e.name).filter((n) => !n.startsWith(".")))
    .catch(() => null);
  try { return (await Promise.race([read, timeout])) ?? []; } finally { if (timer) clearTimeout(timer); }
}

async function readDoc(path: string): Promise<BrainDoc | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((r) => { timer = setTimeout(() => r(null), READ_TIMEOUT_MS); });
  const read = (async () => {
    const [content, stat] = await Promise.all([fs.readFile(path, "utf-8"), fs.stat(path)]);
    return { path, content, mtimeMs: stat.mtimeMs } as BrainDoc;
  })().catch(() => null);
  try { return await Promise.race([read, timeout]); } finally { if (timer) clearTimeout(timer); }
}

/** Read the corpus (root + one level + projects/*) and report stale + duplicates. */
export async function scanBrainHygiene(opts: {
  brainRootDir?: string; now?: number; staleDays?: number; threshold?: number;
} = {}): Promise<{ stale: StaleDoc[]; duplicates: DuplicateGroup[]; scanned: number }> {
  const root = opts.brainRootDir ?? configuredBrainRootDir();
  if (!root) return { stale: [], duplicates: [], scanned: 0 };
  const isDoc = (n: string) => /\.(md|html?)$/i.test(n);
  const rels: string[] = [];
  for (const f of await listDir(root, false)) if (isDoc(f)) rels.push(f);
  for (const dir of await listDir(root, true)) {
    if (dir === "_archived") continue; // Brain Review archived docs — never scanned (§4)
    for (const f of await listDir(join(root, dir), false)) if (isDoc(f)) rels.push(join(dir, f));
    for (const sub of await listDir(join(root, dir), true)) {
      if (sub === "_archived") continue;
      for (const f of await listDir(join(root, dir, sub), false)) if (isDoc(f)) rels.push(join(dir, sub, f));
    }
  }
  const docs: BrainDoc[] = [];
  for (const rel of rels.slice(0, MAX_DOCS)) {
    const d = await readDoc(join(root, rel));
    if (d) docs.push({ ...d, path: rel });
  }
  return {
    stale: findStale(docs, { now: opts.now, staleDays: opts.staleDays }),
    duplicates: findDuplicates(docs, { threshold: opts.threshold }),
    scanned: docs.length,
  };
}
