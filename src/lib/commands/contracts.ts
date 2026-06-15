/**
 * Local Claude command/skill catalog — the operator's OWN slash commands and
 * folder skills, read from their Claude install (under a profile's config dir).
 * This is SEPARATE from the brain skill library (src/lib/skills/*): those are
 * HiveMatrix's portable, distilled recipes; these are pre-existing assets the
 * Claude CLI already resolves as `/name` slash commands. We list them so the
 * operator can run them as tasks, and optionally import the folder skills into
 * the brain library.
 *
 * Two on-disk shapes, both invocable as `/name`:
 *   - Flat command:  <configDir>/commands/<...>/<name>.md  (subdirs namespace → "ns:name")
 *   - Folder skill:  <configDir>/skills/<name>/SKILL.md     (+ bundled files like pull.sh)
 *
 * Frontmatter is the same `---\n…\n---` block the brain skills use, so we reuse
 * the dependency-free `:`-split parser shape from src/lib/skills/contracts.ts.
 */

export type LocalCommandKind = "command" | "skill";

export interface LocalCommand {
  /** The slash target: "import-all" or subdir-namespaced "ns:name". */
  invokeName: string;
  /** Human label (== invokeName for commands; SKILL.md `name` for skills). */
  displayName: string;
  kind: LocalCommandKind;
  /** v1 is user/profile scope only; project scope is a follow-on. */
  scope: "user";
  description: string;
  /** Frontmatter `argument-hint`, shown to the operator (informational). */
  argumentHint: string;
  /** Frontmatter `allowed-tools` (raw string, informational). */
  allowedTools: string;
  /** Frontmatter `model` — commands only. */
  model?: string;
  /** Absolute path to the .md / SKILL.md on disk. */
  sourcePath: string;
  /** A skill folder bundles files beyond SKILL.md (scripts etc.). */
  hasBundledFiles: boolean;
  bundledFileCount: number;
}

/**
 * Split a `---` frontmatter block from the body. Dependency-free (no YAML lib),
 * but tolerant of the shapes real SKILL.md / command files use: plain
 * `key: value`, and YAML block scalars (`key: >-` / `|`) whose text continues on
 * the following more-indented lines (folded into one value). Unknown/blank →
 * `{}`/full-content. Keys are taken verbatim (lowercased-as-written).
 */
export function splitFrontmatter(content: string): { fm: Record<string, string>; body: string } {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: content.trim() };
  const fm: Record<string, string> = {};
  const lines = m[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    // Only treat a line as a key if the key has no leading indentation — indented
    // lines belong to a preceding block scalar (handled below).
    if (/^\s/.test(line)) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    let value = line.slice(idx + 1).trim();
    // YAML block scalar: fold the following more-indented lines into the value.
    if (value === ">" || value === ">-" || value === "|" || value === "|-") {
      const literal = value[0] === "|";
      const collected: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) {
        i++;
        collected.push(lines[i].replace(/^\s+/, ""));
      }
      value = literal ? collected.join("\n").trim() : collected.join(" ").replace(/\s+/g, " ").trim();
    }
    fm[key] = value;
  }
  return { fm, body: m[2].trim() };
}

/** Strip a leading/trailing quote pair from a frontmatter value. */
function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Build a LocalCommand from a flat command `.md`. invokeName is precomputed by
 *  the scanner from the path. All frontmatter is optional. */
export function parseCommandFile(content: string, invokeName: string, sourcePath: string): LocalCommand {
  const { fm } = splitFrontmatter(content);
  return {
    invokeName,
    displayName: invokeName,
    kind: "command",
    scope: "user",
    description: unquote(fm["description"] ?? ""),
    argumentHint: unquote(fm["argument-hint"] ?? ""),
    allowedTools: unquote(fm["allowed-tools"] ?? ""),
    model: fm["model"] ? unquote(fm["model"]) : undefined,
    sourcePath,
    hasBundledFiles: false,
    bundledFileCount: 0,
  };
}

/** Build a LocalCommand from a SKILL.md. `dirName` is the folder name (fallback
 *  invoke/display name); frontmatter `name` overrides it. */
export function parseSkillManifest(
  content: string,
  dirName: string,
  sourcePath: string,
  bundledFileCount: number,
): LocalCommand {
  const { fm } = splitFrontmatter(content);
  const name = unquote(fm["name"] || dirName);
  return {
    invokeName: name,
    displayName: name,
    kind: "skill",
    scope: "user",
    description: unquote(fm["description"] ?? ""),
    argumentHint: unquote(fm["argument-hint"] ?? ""),
    allowedTools: unquote(fm["allowed-tools"] ?? ""),
    sourcePath,
    hasBundledFiles: bundledFileCount > 0,
    bundledFileCount,
  };
}

/** Is a SKILL.md explicitly marked non-invocable? (excluded from the run list) */
export function skillIsUserInvocable(content: string): boolean {
  const { fm } = splitFrontmatter(content);
  return unquote(fm["user-invocable"] ?? "").toLowerCase() !== "false";
}

/** The SKILL.md body (sans frontmatter) — what bulk-import copies into the brain. */
export function skillManifestBody(content: string): string {
  return splitFrontmatter(content).body;
}
