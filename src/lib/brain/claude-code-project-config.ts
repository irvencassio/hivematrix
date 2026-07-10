/**
 * Project-scoped Claude Code core files, surfaced read-only alongside a Brain
 * project's own docs (an extension of §7's pinned concept to the per-project
 * case). Brain projects are brain-doc groupings under <brainRoot>/projects/,
 * not code repos — there's no inherent link between the two — so a Brain
 * project is matched to a code project by name via the existing project
 * discovery scan (project-discovery.ts), and these four well-known files are
 * checked at that code project's root:
 *
 *   CLAUDE.md            — ./CLAUDE.md, falling back to ./.claude/CLAUDE.md
 *   settings.json        — ./.claude/settings.json
 *   settings.local.json  — ./.claude/settings.local.json
 *   .mcp.json            — ./.mcp.json (project-rooted, unlike the others)
 *
 * `file` values are namespaced under a "claude-code/" prefix so they can
 * never collide with a real brain doc's filename and sort together in the
 * doc list. Never archivable/excludable/deletable — read-only visibility only.
 */

import { promises as fs } from "fs";
import { join } from "path";
import { BRAIN_READ_TIMEOUT_MS, readWithTimeout } from "@/lib/brain/memory-bundle";
import { classifyDoc, type BrainDocSummary, type BrainDocContent } from "@/lib/brain/doc-review";
import { discoverProjects } from "@/lib/routing/project-discovery";

export const CONFIG_FILE_PREFIX = "claude-code/";

interface ConfigFileSpec {
  /** Suffix after CONFIG_FILE_PREFIX, e.g. "CLAUDE.md". */
  name: string;
  /** Candidate paths relative to the project root, tried in order — first match wins. */
  candidates: string[];
}

const CONFIG_FILE_SPECS: ConfigFileSpec[] = [
  { name: "CLAUDE.md", candidates: ["CLAUDE.md", join(".claude", "CLAUDE.md")] },
  { name: "settings.json", candidates: [join(".claude", "settings.json")] },
  { name: "settings.local.json", candidates: [join(".claude", "settings.local.json")] },
  { name: ".mcp.json", candidates: [".mcp.json"] },
];

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** The code project whose discovered name best matches a Brain project's slug, if any. */
export function findMatchingCodeProjectPath(brainSlug: string): string | null {
  const target = normalizeForMatch(brainSlug);
  if (!target) return null;
  let projects;
  try {
    projects = discoverProjects();
  } catch {
    return null;
  }
  const match = projects.find((p) => normalizeForMatch(p.name) === target);
  return match?.path ?? null;
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

/** Resolve the first existing candidate path for a spec, or null if none exist. */
async function resolveExistingCandidate(projectPath: string, spec: ConfigFileSpec): Promise<{ fullPath: string; stat: { mtimeMs: number; size: number } } | null> {
  for (const candidate of spec.candidates) {
    const fullPath = join(projectPath, candidate);
    const stat = await statWithTimeout(fullPath);
    if (stat) return { fullPath, stat };
  }
  return null;
}

/** Config-file docs for the code project matching this Brain project slug — [] if no match or no files found. */
export async function listProjectConfigDocs(brainSlug: string): Promise<BrainDocSummary[]> {
  const projectPath = findMatchingCodeProjectPath(brainSlug);
  if (!projectPath) return [];

  const out: BrainDocSummary[] = [];
  for (const spec of CONFIG_FILE_SPECS) {
    const found = await resolveExistingCandidate(projectPath, spec);
    if (!found) continue;
    const { status, badge } = classifyDoc({
      isExcluded: false,
      isBriefLoaded: true, // forced ⭐ — harness config, always relevant when working in this project
      isCtxLoaded: false,
      isStale: false,
      isIndexed: false,
    });
    out.push({
      project: brainSlug,
      file: CONFIG_FILE_PREFIX + spec.name,
      path: found.fullPath,
      status,
      badge,
      modified: found.stat.mtimeMs,
      sizeBytes: found.stat.size,
      indexed: false,
      backlinks: 0,
      archived: false,
      excluded: false,
      configFile: true,
    });
  }
  return out;
}

/** Raw content for a "claude-code/<name>" file. Returns null for any other `file` value. */
export async function readProjectConfigDoc(brainSlug: string, file: string): Promise<BrainDocContent | null> {
  if (!file.startsWith(CONFIG_FILE_PREFIX)) return null;
  const name = file.slice(CONFIG_FILE_PREFIX.length);
  const spec = CONFIG_FILE_SPECS.find((s) => s.name === name);
  if (!spec) return null;
  const projectPath = findMatchingCodeProjectPath(brainSlug);
  if (!projectPath) return null;
  const found = await resolveExistingCandidate(projectPath, spec);
  if (!found) return null;
  const content = await readWithTimeout(found.fullPath);
  if (content == null) return null;
  return {
    content,
    path: found.fullPath,
    modified: found.stat.mtimeMs,
    sizeBytes: found.stat.size,
  };
}
