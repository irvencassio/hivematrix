/**
 * "Always loaded" pinned pseudo-project (§7 of the design spec) — read-only
 * surfacing of harness-owned files, so the operator can see whether they
 * exist (and what they say) without hunting for them manually. Not
 * archivable or excludable: these files' loading is owned by the Claude CLI
 * harness, not HiveMatrix — the daemon only reads them, never controls their
 * injection.
 *
 * Covers the two truly GLOBAL core files (per the operator's own reference
 * breakdown of Claude Code's file model):
 *   - CLAUDE.md     — ~/.claude/CLAUDE.md (instructions)
 *   - settings.json — ~/.claude/settings.json (permissions/hooks/env/model)
 * `.mcp.json` has no user-level equivalent (user-scoped MCP servers live in
 * ~/.claude.json instead, which also holds OAuth/app state — deliberately
 * NOT surfaced here, unlike the other two which are plain local config).
 *
 * Project-scoped versions of these same three files (plus .mcp.json, which
 * IS project-rooted) are handled separately in claude-code-project-config.ts,
 * since they require matching a Brain project to a code project's path.
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

export function userSettingsJsonPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

const PINNED_FILES: Array<{ file: string; resolve: () => string; displayPath: string }> = [
  { file: "CLAUDE.md", resolve: userClaudeMdPath, displayPath: "~/.claude/CLAUDE.md" },
  { file: "settings.json", resolve: userSettingsJsonPath, displayPath: "~/.claude/settings.json" },
];

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

/** The pinned doc list — only files that actually exist show up (an honest, not-loaded reality). */
export async function listPinnedDocs(): Promise<BrainDocSummary[]> {
  const out: BrainDocSummary[] = [];
  for (const entry of PINNED_FILES) {
    const path = entry.resolve();
    const stat = await statWithTimeout(path);
    if (!stat) continue;
    const { status, badge } = classifyDoc({
      isExcluded: false,
      isBriefLoaded: true, // forced ⭐ — harness-loaded, not derived from the usual auto-load set
      isCtxLoaded: false,
      isStale: false,
      isIndexed: false,
    });
    out.push({
      project: PINNED_PROJECT_SLUG,
      file: entry.file,
      path: entry.displayPath,
      status,
      badge,
      modified: stat.mtimeMs,
      sizeBytes: stat.size,
      indexed: false,
      backlinks: 0,
      archived: false,
      excluded: false,
      configFile: true,
    });
  }
  return out;
}

/** Raw content for the render pane. Only a known pinned filename is valid. */
export async function readPinnedDoc(file: string): Promise<BrainDocContent | null> {
  const entry = PINNED_FILES.find((f) => f.file === file);
  if (!entry) return null;
  const path = entry.resolve();
  const [content, stat] = await Promise.all([readWithTimeout(path), statWithTimeout(path)]);
  if (content == null) return null;
  return {
    content,
    path: entry.displayPath,
    modified: stat?.mtimeMs ?? 0,
    sizeBytes: stat?.size ?? content.length,
  };
}
