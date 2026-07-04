/**
 * Brain link graph — `[[wikilink]]` backlinks across brain docs.
 *
 * Brain docs (and memory files) cross-reference each other with `[[name]]`. This
 * builds the forward-link + backlink graph so the agent can pull in related docs
 * ("what else references this decision?") that keyword/semantic search misses.
 * Deterministic, bounded, and Drive-stall safe (async + per-file timeouts).
 */

import { promises as fs } from "fs";
import { join } from "path";
import { configuredBrainRootDir } from "@/lib/brain/settings";

const READ_TIMEOUT_MS = 3_000;
const MAX_DOCS = 500;

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Targets referenced by `[[name]]` / `[[name|alias]]` in a doc, slugified + deduped. */
export function extractWikiLinks(content: string): string[] {
  const out = new Set<string>();
  const re = /\[\[([^[\]|]+?)(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const t = slugify(m[1]);
    if (t) out.add(t);
  }
  return [...out];
}

/** A doc's link key: basename without date prefix / extension, slugified. */
export function docSlug(relPath: string): string {
  const base = (relPath.split("/").pop() ?? relPath).replace(/\.(md|html?)$/i, "");
  return slugify(base);
}

export interface LinkNode { doc: string; slug: string; links: string[] }
export interface LinkGraph { nodes: LinkNode[] }

async function readWithTimeout(path: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((r) => { timer = setTimeout(() => r(null), READ_TIMEOUT_MS); });
  const read = fs.readFile(path, "utf-8").then((c) => c as string).catch(() => null);
  try { return await Promise.race([read, timeout]); } finally { if (timer) clearTimeout(timer); }
}

async function listDir(path: string, dirsOnly: boolean): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((r) => { timer = setTimeout(() => r(null), READ_TIMEOUT_MS); });
  const read = fs.readdir(path, { withFileTypes: true })
    .then((es) => es.filter((e) => (dirsOnly ? e.isDirectory() : e.isFile())).map((e) => e.name).filter((n) => !n.startsWith(".")))
    .catch(() => null);
  try { return (await Promise.race([read, timeout])) ?? []; } finally { if (timer) clearTimeout(timer); }
}

/** Scan the brain root + one level of subdirs for docs and build the link graph. */
export async function buildLinkGraph(opts: { brainRootDir?: string } = {}): Promise<LinkGraph> {
  const root = opts.brainRootDir ?? configuredBrainRootDir();
  if (!root) return { nodes: [] };
  const isDoc = (n: string) => /\.(md|html?)$/i.test(n);
  const paths: string[] = [];

  for (const f of await listDir(root, false)) if (isDoc(f)) paths.push(f);
  for (const dir of await listDir(root, true)) {
    if (paths.length >= MAX_DOCS) break;
    for (const f of await listDir(join(root, dir), false)) if (isDoc(f)) paths.push(join(dir, f));
    // one more level (e.g. projects/<proj>/<doc>)
    for (const sub of await listDir(join(root, dir), true)) {
      if (paths.length >= MAX_DOCS) break;
      for (const f of await listDir(join(root, dir, sub), false)) if (isDoc(f)) paths.push(join(dir, sub, f));
    }
  }

  const nodes: LinkNode[] = [];
  for (const rel of paths.slice(0, MAX_DOCS)) {
    const content = await readWithTimeout(join(root, rel));
    if (content == null) continue;
    nodes.push({ doc: rel, slug: docSlug(rel), links: extractWikiLinks(content) });
  }
  return { nodes };
}

/** Resolve a `[[target]]` to the doc whose slug matches (exact, else suffix). */
export function resolveTarget(target: string, graph: LinkGraph): string | null {
  const t = slugify(target);
  const exact = graph.nodes.find((n) => n.slug === t);
  if (exact) return exact.doc;
  const suffix = graph.nodes.find((n) => n.slug.endsWith(`-${t}`) || n.slug === t);
  return suffix ? suffix.doc : null;
}

/** Docs that link TO `target` (by its slug). */
export function backlinksFor(target: string, graph: LinkGraph): string[] {
  const t = slugify(target);
  return graph.nodes.filter((n) => n.links.includes(t)).map((n) => n.doc);
}

/** Forward + backlinks for a doc name/slug. */
export function linksForDoc(docOrSlug: string, graph: LinkGraph): { resolved: string | null; links: string[]; backlinks: string[] } {
  const t = slugify(docOrSlug.replace(/\.(md|html?)$/i, "").split("/").pop() ?? docOrSlug);
  const node = graph.nodes.find((n) => n.doc === docOrSlug) ?? graph.nodes.find((n) => n.slug === t);
  return {
    resolved: node ? node.doc : resolveTarget(t, graph),
    links: node ? node.links : [],
    backlinks: backlinksFor(t, graph),
  };
}
