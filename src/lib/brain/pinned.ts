/**
 * "Always loaded" pinned pseudo-project (§7 of the design spec) — read-only
 * surfacing of the harness-owned CLAUDE.md, so the operator can see whether it
 * exists (and what it says) without hunting for it manually. Not archivable
 * or excludable: this file's loading is owned by the Claude CLI harness, not
 * HiveMatrix — the daemon only reads it, never controls its injection.
 *
 * Scoping note: the design mockup also pictures a per-project MEMORY.md
 * (~/.claude/projects/<encoded-projectPath>/memory/MEMORY.md, subprocess.ts:637).
 * That path is keyed by one specific code project's filesystem path, not
 * global — it doesn't fit "pulled into every task, any project" the way
 * CLAUDE.md does, so it's left out of this global pinned view rather than
 * arbitrarily picking one project to overfit the pinned concept to.
 */

import { promises as fs } from "fs";
import { homedir } from "os";
import { join } from "path";
import { BRAIN_READ_TIMEOUT_MS, readWithTimeout } from "@/lib/brain/memory-bundle";
import { classifyDoc, type BrainDocSummary, type BrainDocContent } from "@/lib/brain/doc-review";

export const PINNED_PROJECT_SLUG = "__pinned__";
export const PINNED_PROJECT_LABEL = "Always loaded";

export function userClaudeMdPath(): string {
  return join(homedir(), ".claude", "CLAUDE.md");
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

/** The pinned doc list — empty when CLAUDE.md doesn't exist (an honest, not-loaded reality). */
export async function listPinnedDocs(): Promise<BrainDocSummary[]> {
  const path = userClaudeMdPath();
  const stat = await statWithTimeout(path);
  if (!stat) return [];
  const { status, badge } = classifyDoc({
    isExcluded: false,
    isBriefLoaded: true, // forced ⭐ — harness-loaded, not derived from the usual auto-load set
    isCtxLoaded: false,
    isStale: false,
    isIndexed: false,
  });
  return [{
    project: PINNED_PROJECT_SLUG,
    file: "CLAUDE.md",
    path: "~/.claude/CLAUDE.md",
    status,
    badge,
    modified: stat.mtimeMs,
    sizeBytes: stat.size,
    indexed: false,
    backlinks: 0,
    archived: false,
    excluded: false,
  }];
}

/** Raw content for the render pane. Only "CLAUDE.md" is a valid pinned file. */
export async function readPinnedDoc(file: string): Promise<BrainDocContent | null> {
  if (file !== "CLAUDE.md") return null;
  const path = userClaudeMdPath();
  const [content, stat] = await Promise.all([readWithTimeout(path), statWithTimeout(path)]);
  if (content == null) return null;
  return {
    content,
    path: "~/.claude/CLAUDE.md",
    modified: stat?.mtimeMs ?? 0,
    sizeBytes: stat?.size ?? content.length,
  };
}
