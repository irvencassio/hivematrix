/**
 * Brain weekly digest — "what shifted in the brain this week."
 *
 * Gathers brain docs modified within a recent window and builds an agent task
 * that reads them and writes a summary brain doc (the auto-summarization the
 * planning docs asked for). Follows the digest idiom: pure helpers here, the
 * agent does the LLM work. Bounded + Drive-stall safe.
 */

import { promises as fs } from "fs";
import { join } from "path";
import { configuredBrainRootDir } from "@/lib/brain/settings";

const STAT_TIMEOUT_MS = 3_000;
const DEFAULT_SINCE_DAYS = 7;
const DEFAULT_MAX_DOCS = 40;

export interface RecentDoc { path: string; mtimeMs: number }

async function listDir(path: string, dirsOnly: boolean): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((r) => { timer = setTimeout(() => r(null), STAT_TIMEOUT_MS); });
  const read = fs.readdir(path, { withFileTypes: true })
    .then((es) => es.filter((e) => (dirsOnly ? e.isDirectory() : e.isFile())).map((e) => e.name).filter((n) => !n.startsWith(".")))
    .catch(() => null);
  try { return (await Promise.race([read, timeout])) ?? []; } finally { if (timer) clearTimeout(timer); }
}

async function statMtime(path: string): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((r) => { timer = setTimeout(() => r(null), STAT_TIMEOUT_MS); });
  const stat = fs.stat(path).then((s) => s.mtimeMs).catch(() => null);
  try { return await Promise.race([stat, timeout]); } finally { if (timer) clearTimeout(timer); }
}

/** Brain docs modified within `sinceDays`, newest first, bounded. */
export async function recentBrainDocs(opts: {
  brainRootDir?: string; sinceDays?: number; max?: number; now?: number;
} = {}): Promise<RecentDoc[]> {
  const root = opts.brainRootDir ?? configuredBrainRootDir();
  if (!root) return [];
  const now = opts.now ?? Date.now();
  const cutoff = now - (opts.sinceDays ?? DEFAULT_SINCE_DAYS) * 86_400_000;
  const max = opts.max ?? DEFAULT_MAX_DOCS;
  const isDoc = (n: string) => /\.(md|html?)$/i.test(n);

  const rels: string[] = [];
  for (const f of await listDir(root, false)) if (isDoc(f)) rels.push(f);
  for (const dir of await listDir(root, true)) {
    for (const f of await listDir(join(root, dir), false)) if (isDoc(f)) rels.push(join(dir, f));
    for (const sub of await listDir(join(root, dir), true)) {
      for (const f of await listDir(join(root, dir, sub), false)) if (isDoc(f)) rels.push(join(dir, sub, f));
    }
  }

  const out: RecentDoc[] = [];
  for (const rel of rels) {
    const m = await statMtime(join(root, rel));
    if (m != null && m >= cutoff) out.push({ path: rel, mtimeMs: m });
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out.slice(0, max);
}

export function weeklyDigestFilename(dateStr: string): string {
  return `${dateStr}-brain-weekly-digest.md`;
}

/** Task instructions: read the recent docs and write a "what shifted" digest. */
export function buildBrainDigestTaskDescription(input: {
  docs: RecentDoc[]; docPath: string; sinceDays: number;
}): string {
  const list = input.docs.map((d) => `  - ${d.path}`).join("\n");
  return [
    `Write a "what shifted in the brain" weekly digest covering the last ${input.sinceDays} days.`,
    "",
    `These brain docs changed recently (newest first):`,
    list || "  (none — say so in the digest)",
    "",
    "Steps:",
    "1. Read the most relevant of these docs (use brain_search / read_file). Prioritize decisions, plans, and status changes.",
    "2. Write a tight digest: a 3-6 sentence overview of what changed and why it matters, then grouped bullets (Decisions, In progress, New/Updated docs).",
    `3. Save it as a markdown brain doc to: ${input.docPath}`,
    "   The doc must start with a '# Brain Weekly Digest' heading and end with a 'Docs reviewed:' list of the files you used.",
    "",
    "Keep it factual and skimmable. Link related docs with [[doc-slug]] so the digest joins the brain link graph.",
  ].join("\n");
}
