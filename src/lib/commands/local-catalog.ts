/**
 * Scan a local profile's config dir for runnable local assets: flat slash
 * commands (<configDir>/commands/**\/*.md) and folder skills
 * (<configDir>/skills/<name>/SKILL.md). The config dir is resolved IDENTICALLY
 * to subprocess.ts (`${HOME}/${normalizeConfigDir(profile ?? active)}`) so the
 * listing and the eventual `/name` run happen under the same CLAUDE_CONFIG_DIR.
 *
 * Cloud-stall discipline mirrors the brain skill store: timed reads (the config
 * dir may be a dehydrating mount), a bounded readdir walk, and a hard cap.
 */

import { promises as fs } from "fs";
import type { Dirent } from "fs";
import { join, relative, sep } from "path";
import { homedir } from "os";
import { getActiveProfile } from "@/lib/config/constants";
import {
  parseCommandFile, parseSkillManifest, skillIsUserInvocable, skillManifestBody,
  type LocalCommand,
} from "./contracts";

const READ_TIMEOUT_MS = 3_000;
const MAX_COMMANDS = 300; // shared cap across both sources
const MAX_WALK_DEPTH = 6; // bound recursion into commands/

/** Mirror subprocess.ts normalizeConfigDir: dot-prefix the profile name. */
function normalizeConfigDir(profile: string): string {
  return profile.startsWith(".") ? profile : `.${profile}`;
}

/** `${HOME}/.claude[-x]` for the given (or active) profile. */
function resolveConfigDir(profile?: string): string {
  const dir = profile ? normalizeConfigDir(profile) : getActiveProfile();
  return join(homedir(), dir);
}

async function readWithTimeout(path: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((r) => { timer = setTimeout(() => r(null), READ_TIMEOUT_MS); });
  const read = fs.readFile(path, "utf-8").then((c) => c as string).catch(() => null);
  try { return await Promise.race([read, timeout]); } finally { if (timer) clearTimeout(timer); }
}

/**
 * Recursively collect *.md under commands/. Namespacing: commands/foo/bar.md →
 * invokeName "foo:bar"; commands/baz.md → "baz". Bounded by depth + the shared cap.
 */
async function walkCommands(root: string, out: LocalCommand[]): Promise<void> {
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length && out.length < MAX_COMMANDS) {
    const { dir, depth } = stack.pop()!;
    let entries: Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { continue; } // missing/unreadable dir → skip
    for (const e of entries) {
      if (out.length >= MAX_COMMANDS) break;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < MAX_WALK_DEPTH) stack.push({ dir: full, depth: depth + 1 });
      } else if (e.isFile() && e.name.endsWith(".md")) {
        const rel = relative(root, full).replace(/\.md$/, "");
        const invokeName = rel.split(sep).join(":");
        const raw = await readWithTimeout(full);
        if (raw == null) continue; // stalled/unreadable → skip
        out.push(parseCommandFile(raw, invokeName, full));
      }
    }
  }
}

/** Collect <skills>/<name>/SKILL.md folder skills (one level deep). */
async function scanSkills(root: string, out: LocalCommand[]): Promise<void> {
  let dirs: Dirent[];
  try { dirs = await fs.readdir(root, { withFileTypes: true }); }
  catch { return; } // missing dir → skip
  for (const d of dirs) {
    if (out.length >= MAX_COMMANDS) break;
    if (!d.isDirectory()) continue;
    const skillDir = join(root, d.name);
    const manifest = join(skillDir, "SKILL.md");
    const raw = await readWithTimeout(manifest);
    if (raw == null) continue; // no SKILL.md (or stalled) → skip
    if (!skillIsUserInvocable(raw)) continue; // explicitly non-invocable → not runnable
    let bundledFileCount = 0;
    try {
      const inner = await fs.readdir(skillDir);
      bundledFileCount = inner.filter((f) => f !== "SKILL.md").length;
    } catch { /* leave 0 */ }
    out.push(parseSkillManifest(raw, d.name, manifest, bundledFileCount));
  }
}

/**
 * Scan the active (or given) profile's config dir for runnable local commands
 * and folder skills. Bounded, cloud-stall safe, missing dirs → []. Sorted:
 * commands first, then skills, each alphabetical by invokeName.
 */
export async function scanLocalCommands(profile?: string): Promise<LocalCommand[]> {
  const configDir = resolveConfigDir(profile);
  const out: LocalCommand[] = [];
  await walkCommands(join(configDir, "commands"), out);
  await scanSkills(join(configDir, "skills"), out);
  return out.sort((a, b) =>
    a.kind === b.kind ? a.invokeName.localeCompare(b.invokeName) : a.kind === "command" ? -1 : 1);
}

/** Read a SKILL.md and return its body (sans frontmatter) for bulk-import. */
export async function readManifestBody(sourcePath: string): Promise<string | null> {
  const raw = await readWithTimeout(sourcePath);
  return raw == null ? null : skillManifestBody(raw);
}
