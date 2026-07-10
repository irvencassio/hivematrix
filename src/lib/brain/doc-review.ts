/**
 * Brain / Memory Review — per-project document status derivation for the
 * console screen (docs/superpowers/specs/2026-07-09-brain-memory-review-console-design.md).
 *
 * Status is derived from what the code ACTUALLY does, not from filename
 * convention: "brief"/"ctx" mirror buildBrainMemoryBundle's real auto-load set
 * (memory-bundle.ts), "indexed" mirrors the semantic-index sidecar, "stale"
 * mirrors findStale() (hygiene.ts), "excluded" mirrors the exclusions sidecar
 * (exclusions.ts, §5 — enforced in the loaders/walkers, not just here).
 *
 * Every filesystem touch is async + timeout-bounded (BRAIN_READ_TIMEOUT_MS) —
 * the brain root is commonly a Google Drive mount that can dehydrate.
 */

import { promises as fs } from "fs";
import { isAbsolute, join, relative, resolve, sep } from "path";
import {
  BRAIN_READ_TIMEOUT_MS,
  DEFAULT_CANONICAL_PROJECT,
  listDirWithTimeout,
  readWithTimeout,
} from "@/lib/brain/memory-bundle";
import { configuredBrainRootDir } from "@/lib/brain/settings";
import { findStale } from "@/lib/brain/hygiene";
import { buildLinkGraph, linksForDoc, type LinkGraph } from "@/lib/brain/links";
import { loadExclusions } from "@/lib/brain/exclusions";
import { loadIndex } from "@/lib/embeddings/index-store";
import { isEmbeddingsEnabled } from "@/lib/embeddings/provider";

const MAX_DOCS_PER_PROJECT = 300;
const DOC_EXTENSION_RE = /\.(md|markdown|txt|html?|mdx)$/i;
// Directories a doc-review listing never descends into or reports on — mirrors
// the skip sets in search.ts/indexer.ts/hygiene.ts, plus the future archive dir
// (archived docs are deliberately excluded from every corpus walker, §5).
const SKIP_DIRS = new Set([".git", "node_modules", ".obsidian", ".trash", "_archived"]);

export type BrainDocStatus = "excluded" | "brief" | "ctx" | "stale" | "indexed" | "orphan";

export const STATUS_BADGE: Record<BrainDocStatus, string> = {
  excluded: "🔴",
  brief: "⭐",
  ctx: "🟢",
  stale: "🟠",
  indexed: "🔵",
  orphan: "⚪",
};

export interface BrainDocSummary {
  project: string;
  /** Path relative to the project dir, e.g. "lanes/manager.md". */
  file: string;
  /** Brain-relative path from brainRoot, e.g. "projects/hive/lanes/manager.md". */
  path: string;
  status: BrainDocStatus;
  badge: string;
  modified: number; // epochMs
  sizeBytes: number;
  indexed: boolean;
  backlinks: number;
  /** Always false until §4 (archive) ships. */
  archived: boolean;
  /** Always false until §3 (exclude) ships. */
  excluded: boolean;
  /** A Claude Code harness config file (CLAUDE.md/settings.json/.mcp.json) surfaced
   * read-only alongside this project's brain docs — never archivable/excludable. */
  configFile?: boolean;
}

export interface BrainProjectSummary {
  slug: string;
  label: string;
  docCount: number;
}

function brainRoot(override?: string): string | null {
  return override ? override : configuredBrainRootDir();
}

function projectsRootDir(root: string): string {
  return join(root, "projects");
}

/** A relFile path (may be nested, e.g. "lanes/manager.md") must not escape its parent dir. */
function isSafeRelPath(segment: string): boolean {
  if (!segment || segment.includes("\0")) return false;
  if (isAbsolute(segment)) return false;
  return !segment.split(/[/\\]/).some((part) => part === ".." || part === "");
}

/** A project slug is a single path segment — no nesting, no traversal. */
function isSafeSlug(slug: string): boolean {
  return isSafeRelPath(slug) && !/[/\\]/.test(slug);
}

/** Resolve `relFile` inside `baseDir`, rejecting any traversal outside it. */
function resolveInside(baseDir: string, relFile: string): string | null {
  if (!isSafeRelPath(relFile)) return null;
  const base = resolve(baseDir);
  const resolved = resolve(base, relFile);
  if (resolved !== base && !resolved.startsWith(base + sep)) return null;
  return resolved;
}

async function statWithTimeout(path: string, timeoutMs = BRAIN_READ_TIMEOUT_MS): Promise<{ mtimeMs: number; size: number } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((res) => { timer = setTimeout(() => res(null), timeoutMs); });
  const read = fs.stat(path).then((s) => ({ mtimeMs: s.mtimeMs, size: s.size })).catch(() => null);
  try {
    return await Promise.race([read, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** List `<brainRoot>/projects/*` with a doc count each. Bounded, Drive-stall safe. */
export async function listProjects(brainRootDir?: string): Promise<BrainProjectSummary[]> {
  const root = brainRoot(brainRootDir);
  if (!root) return [];
  const slugs = (await listDirWithTimeout(projectsRootDir(root), { dirsOnly: true })).sort();
  const out: BrainProjectSummary[] = [];
  for (const slug of slugs) {
    const files = await collectProjectFiles(join(projectsRootDir(root), slug));
    out.push({ slug, label: slug, docCount: files.length });
  }
  return out;
}

/** One level of project-root files + one level of subdirectory files (lanes/, runbooks/, ...). */
async function collectProjectFiles(projectDir: string): Promise<string[]> {
  const out: string[] = [];
  const rootFiles = await listDirWithTimeout(projectDir);
  for (const f of rootFiles) if (DOC_EXTENSION_RE.test(f)) out.push(f);

  const subdirs = await listDirWithTimeout(projectDir, { dirsOnly: true });
  for (const dir of subdirs) {
    if (SKIP_DIRS.has(dir) || out.length >= MAX_DOCS_PER_PROJECT) continue;
    const files = await listDirWithTimeout(join(projectDir, dir));
    for (const f of files) {
      if (DOC_EXTENSION_RE.test(f)) out.push(join(dir, f));
      if (out.length >= MAX_DOCS_PER_PROJECT) break;
    }
  }
  return out.slice(0, MAX_DOCS_PER_PROJECT);
}

/**
 * "brief" is only meaningful for the canonical project (today: "hive") and
 * only its root-level agent-brief.md — mirrors buildBrainMemoryBundle exactly
 * (memory-bundle.ts:147-152). No other project's agent-brief.md is auto-loaded.
 */
export function isProjectBriefLoaded(project: string, file: string): boolean {
  return project === DEFAULT_CANONICAL_PROJECT && file === "agent-brief.md";
}

/**
 * "ctx" mirrors the rest of buildBrainMemoryBundle's canonical-project load set:
 * known-issues.md unconditionally, and any lanes/<lane>.md — which lane loads
 * depends on the invoking bee at task-spawn time, so structurally every file
 * under lanes/ is part of the auto-load set (memory-bundle.ts:152-158).
 */
export function isCtxLoadedFile(project: string, file: string): boolean {
  if (project !== DEFAULT_CANONICAL_PROJECT) return false;
  return file === "known-issues.md" || file.startsWith("lanes/");
}

export interface ClassifyDocInput {
  isExcluded: boolean;
  isBriefLoaded: boolean;
  isCtxLoaded: boolean;
  isStale: boolean;
  isIndexed: boolean;
}

/**
 * Pure precedence: excluded > brief > ctx > stale > indexed > orphan (fallback).
 * Backlinks are informational only (returned alongside, not gating) — the
 * spec's "no backlinks" clause in the orphan definition describes the typical
 * case, but a doc that's wiki-linked yet neither auto-loaded nor semantically
 * indexed still has no code path reading it, so it stays "orphan" here too.
 */
export function classifyDoc(input: ClassifyDocInput): { status: BrainDocStatus; badge: string } {
  const status: BrainDocStatus = input.isExcluded ? "excluded"
    : input.isBriefLoaded ? "brief"
    : input.isCtxLoaded ? "ctx"
    : input.isStale ? "stale"
    : input.isIndexed ? "indexed"
    : "orphan";
  return { status, badge: STATUS_BADGE[status] };
}

export interface ListProjectDocsOptions {
  brainRootDir?: string;
  staleDays?: number;
}

export interface ListProjectDocsResult {
  docs: BrainDocSummary[];
  /** False when the semantic index is off — "indexed"/"orphan" may be unreliable (open risk, §-Open risks). */
  embeddingsEnabled: boolean;
}

export async function listProjectDocs(slug: string, opts: ListProjectDocsOptions = {}): Promise<ListProjectDocsResult> {
  const root = brainRoot(opts.brainRootDir);
  if (!root || !isSafeSlug(slug)) return { docs: [], embeddingsEnabled: isEmbeddingsEnabled() };
  const projectDir = resolveInside(projectsRootDir(root), slug);
  if (!projectDir) return { docs: [], embeddingsEnabled: isEmbeddingsEnabled() };

  const relFiles = await collectProjectFiles(projectDir);
  const archivedRelFiles = await collectProjectFiles(join(projectDir, "_archived"));
  if (relFiles.length === 0 && archivedRelFiles.length === 0) return { docs: [], embeddingsEnabled: isEmbeddingsEnabled() };

  const index = loadIndex();
  const embeddingsEnabled = isEmbeddingsEnabled();
  const excluded = loadExclusions();
  let graph: LinkGraph;
  try {
    graph = await buildLinkGraph({ brainRootDir: root });
  } catch {
    graph = { nodes: [] };
  }

  const stats = await Promise.all(relFiles.map((f) => statWithTimeout(join(projectDir, f))));
  const staleByPath = new Set(
    findStale(
      relFiles.map((f, i) => ({ path: f, content: "", mtimeMs: stats[i]?.mtimeMs ?? Date.now() })),
      { staleDays: opts.staleDays },
    ).map((s) => s.path),
  );

  const docs: BrainDocSummary[] = relFiles.map((file, i) => {
    const stat = stats[i];
    const brainRelPath = relative(root, join(projectDir, file));
    const isIndexed = brainRelPath in index.entries;
    const isDocExcluded = excluded.has(brainRelPath);
    const { backlinks } = linksForDoc(brainRelPath, graph);
    const { status, badge } = classifyDoc({
      isExcluded: isDocExcluded,
      isBriefLoaded: isProjectBriefLoaded(slug, file),
      isCtxLoaded: isCtxLoadedFile(slug, file),
      isStale: staleByPath.has(file),
      isIndexed,
    });
    return {
      project: slug,
      file,
      path: brainRelPath,
      status,
      badge,
      modified: stat?.mtimeMs ?? 0,
      sizeBytes: stat?.size ?? 0,
      indexed: isIndexed,
      backlinks: backlinks.length,
      archived: false,
      excluded: isDocExcluded,
    };
  });

  // Archived docs are physically moved out of context/search/index already
  // (every walker skips _archived) — status here reflects what it would be if
  // restored, purely informational; the console strikes these through and
  // disables further action on them except Restore.
  const archivedStats = await Promise.all(archivedRelFiles.map((f) => statWithTimeout(join(projectDir, "_archived", f))));
  const archivedDocs: BrainDocSummary[] = archivedRelFiles.map((file, i) => {
    const stat = archivedStats[i];
    const brainRelPath = relative(root, join(projectDir, "_archived", file));
    const { status, badge } = classifyDoc({
      isExcluded: false,
      isBriefLoaded: isProjectBriefLoaded(slug, file),
      isCtxLoaded: isCtxLoadedFile(slug, file),
      isStale: false,
      isIndexed: false,
    });
    return {
      project: slug,
      file,
      path: brainRelPath,
      status,
      badge,
      modified: stat?.mtimeMs ?? 0,
      sizeBytes: stat?.size ?? 0,
      indexed: false,
      backlinks: 0,
      archived: true,
      excluded: false,
    };
  });

  return { docs: [...docs, ...archivedDocs], embeddingsEnabled };
}

export interface BrainDocContent {
  content: string;
  path: string;
  modified: number;
  sizeBytes: number;
}

/**
 * Path-guarded, brain-relative path for a (project, relFile) pair — no I/O.
 * Used by mutation endpoints (exclude/archive) that need the exact sidecar
 * key doc-review.ts and the loaders/walkers all key on, without reading the
 * file. Returns null for an unsafe or out-of-bounds path (same guard as
 * readProjectDoc).
 */
export function projectDocBrainRelPath(slug: string, relFile: string, brainRootDir?: string): string | null {
  const root = brainRoot(brainRootDir);
  if (!root || !isSafeSlug(slug)) return null;
  const projectDir = resolveInside(projectsRootDir(root), slug);
  if (!projectDir) return null;
  const fullPath = resolveInside(projectDir, relFile);
  if (!fullPath) return null;
  return relative(root, fullPath);
}

/**
 * Bounded, path-guarded raw-content read for the render pane. Tries the
 * normal project-relative location first, then that project's `_archived/`
 * dir — an archived doc's `file` is unchanged, only its physical location
 * moves, so the client doesn't need to know or say whether it's archived.
 */
export async function readProjectDoc(slug: string, relFile: string, brainRootDir?: string): Promise<BrainDocContent | null> {
  const root = brainRoot(brainRootDir);
  if (!root || !isSafeSlug(slug)) return null;
  const projectDir = resolveInside(projectsRootDir(root), slug);
  if (!projectDir) return null;
  const primaryPath = resolveInside(projectDir, relFile);
  if (!primaryPath) return null;
  const archivedDir = resolveInside(projectDir, "_archived");
  const archivedPath = archivedDir ? resolveInside(archivedDir, relFile) : null;

  for (const fullPath of [primaryPath, archivedPath].filter((p): p is string => p !== null)) {
    const [content, stat] = await Promise.all([readWithTimeout(fullPath), statWithTimeout(fullPath)]);
    if (content == null) continue;
    return {
      content,
      path: relative(root, fullPath),
      modified: stat?.mtimeMs ?? 0,
      sizeBytes: stat?.size ?? content.length,
    };
  }
  return null;
}
