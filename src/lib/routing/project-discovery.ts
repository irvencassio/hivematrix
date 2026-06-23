/**
 * Project discovery for HiveMatrix.
 *
 * Scans multiple sources to find projects the user is actively working on:
 *   1. Git repos under $HOME (primary)
 *   2. Claude Code conversation history (recent projects)
 *   3. VS Code recently opened workspaces
 *
 * Results are merged, deduplicated by resolved path, and sorted by
 * confidence (source count + manifest presence + recency).
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, realpathSync, readdirSync, unlinkSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { homedir } from "os";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProjectSource = "git" | "claude-code" | "vscode";

export interface DiscoveredProject {
  name: string;
  path: string;
  sources: ProjectSource[];
  lastModified: Date;
  hasManifest: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CACHED_PROJECTS_PATH = join(homedir(), ".hivematrix", "discovered-projects.json");
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — discovery is expensive

// Directories to skip during git scan (noise reduction)
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".github", ".vscode", ".idea",
  "dist", "build", "out", "target", "vendor", "__pycache__",
  ".cache", ".npm", ".yarn",
]);

// ─── Cache ───────────────────────────────────────────────────────────────────

function loadCache(): { projects: DiscoveredProject[]; timestamp: number } | null {
  try {
    const data = JSON.parse(readFileSync(CACHED_PROJECTS_PATH, "utf-8"));
    if (Date.now() - data.timestamp < CACHE_TTL_MS) {
      // JSON.stringify turned each Date into a string; revive it so callers'
      // Date methods (.toISOString in /projects, .getTime in sort/preSelect)
      // don't throw on a cached read — the bug that showed "0 projects".
      data.projects = (data.projects ?? []).map((p: DiscoveredProject) => ({ ...p, lastModified: new Date(p.lastModified) }));
      return data;
    }
  } catch {
    // no cache or corrupt
  }
  return null;
}

function saveCache(projects: DiscoveredProject[]): void {
  try {
    mkdirSync(join(homedir(), ".hivematrix"), { recursive: true });
    writeFileSync(CACHED_PROJECTS_PATH, JSON.stringify({ projects, timestamp: Date.now() }, null, 2));
  } catch {
    // non-critical
  }
}

// ─── Source 1: Git repos ────────────────────────────────────────────────────

function scanGitRepos(): Map<string, string> {
  const paths = new Map<string, string>();
  const home = homedir();

  try {
    // `git rev-parse --show-toplevel` for every .git directory under $HOME
    // We use find to locate .git dirs, then resolve the repo root.
    const output = execSync(
      `find "${home}" -maxdepth 4 -name ".git" -type d 2>/dev/null | head -100`,
      { encoding: "utf-8", timeout: 10000 }
    );

    for (const line of output.trim().split("\n")) {
      const gitDir = line.trim();
      if (!gitDir) continue;

      const repoRoot = dirname(gitDir);

      // Skip if this repo is nested inside another discovered repo
      if ([...paths.values()].some((p) => repoRoot.startsWith(p + "/"))) continue;

      // Skip if a parent is already registered
      const parentRegistered = [...paths.values()].some((p) => p.startsWith(repoRoot + "/"));
      if (parentRegistered) continue;

      try {
        const resolved = realpathSync(repoRoot);
        if (!isDiscoverableProjectPath(resolved)) continue;
        paths.set(projectIdentityKey(resolved), resolved);
      } catch {
        // skip
      }
    }
  } catch {
    // find or git may not be available
  }

  return paths;
}

// ─── Source 2: Claude Code history ──────────────────────────────────────────

function scanClaudeCodeHistory(): Map<string, string> {
  const paths = new Map<string, string>();
  const home = homedir();

  // Claude Code stores conversation metadata at ~/.claude/projects/
  // Each subdirectory has a conversations/ folder.
  const claudeProjectsDir = join(home, ".claude", "projects");

  try {
    const entries = readdirSync(claudeProjectsDir, { encoding: "utf-8", withFileTypes: false });

    for (const entry of entries) {
      const projectDir = join(claudeProjectsDir, entry);
      if (existsSync(join(projectDir, "conversations"))) {
        try {
          const resolved = realpathSync(projectDir);
          if (!isDiscoverableProjectPath(resolved)) continue;
          paths.set(projectIdentityKey(resolved), resolved);
        } catch {
          // skip
        }
      }
    }
  } catch {
    // no claude projects dir
  }

  // Also scan direct Claude Code session files if they exist at project level
  // Claude Code stores sessions in .claude/ at project root
  try {
    const output = execSync(
      `find "${home}" -maxdepth 4 -path "*/.claude/settings.local.json" 2>/dev/null | head -50`,
      { encoding: "utf-8", timeout: 5000 }
    );
    for (const line of output.trim().split("\n")) {
      const projectRoot = dirname(dirname(line.trim()));
      if (projectRoot && !projectRoot.startsWith(home + "/.claude")) {
        try {
          const resolved = realpathSync(resolve(projectRoot));
          if (!isDiscoverableProjectPath(resolved)) continue;
          paths.set(projectIdentityKey(resolved), resolved);
        } catch {
          // skip
        }
      }
    }
  } catch {
    // skip
  }

  return paths;
}

// ─── Source 3: VS Code recents ──────────────────────────────────────────────

function scanVSCodeRecents(): Map<string, string> {
  const paths = new Map<string, string>();
  const home = homedir();

  // VS Code stores recent workspaces in the State.vscdb or storage.json
  const candidates = [
    // macOS
    join(home, "Library", "Application Support", "Code", "User", "globalStorage", "storage.json"),
    join(home, "Library", "Application Support", "Code", "User", "workspaceStorage"),
    // Linux
    join(home, ".config", "Code", "User", "globalStorage", "storage.json"),
  ];

  // Try the Storage.json approach — it has Workbench\.workspace\.identities
  for (const storagePath of candidates) {
    try {
      const data = JSON.parse(readFileSync(storagePath, "utf-8"));
      const identities = data?.["workbench.workspaceIdentifiers"] ?? {};
      for (const [, value] of Object.entries(identities)) {
        const v = value as Record<string, unknown>;
        const uri = v?.path as string | undefined;
        if (uri && uri.startsWith("/")) {
          const decoded = decodeURIComponent(uri);
          if (existsSync(decoded) && isDiscoverableProjectPath(decoded)) {
            try {
              const resolved = realpathSync(resolve(decoded));
              if (!isDiscoverableProjectPath(resolved)) continue;
              paths.set(projectIdentityKey(resolved), resolved);
            } catch {
              // skip
            }
          }
        }
      }
    } catch {
      // skip
    }
  }

  // Also check VS Code's recently opened list (macOS-specific location)
  const recentsPath = join(home, "Library", "Application Support", "Code", "CachedData");
  const statePath = join(home, "Library", "Application Support", "Code", "User", "state.vscdb");

  // Simplest reliable source: the `File > Open Recent` plist on macOS
  try {
    const plistPath = join(home, "Library", "Application Support", "Code", "User", "globalStorage", "storage.json");
    const data = JSON.parse(readFileSync(plistPath, "utf-8"));

    // ConfirmedPathsList or openedPathsList
    const entries = data?.openedPathsList?.entries ?? [];
    for (const entry of entries) {
      const uri = entry?.folderUri || entry?.workspace?.configPath || "";
      if (uri.startsWith("file://")) {
        const decoded = decodeURIComponent(uri.replace("file://", ""));
        if (existsSync(decoded) && isDiscoverableProjectPath(decoded)) {
          try {
            const resolved = realpathSync(resolve(decoded));
            if (!isDiscoverableProjectPath(resolved)) continue;
            paths.set(projectIdentityKey(resolved), resolved);
          } catch {
            // skip
          }
        }
      }
    }
  } catch {
    // skip
  }

  return paths;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function projectIdentityKey(path: string): string {
  return path.toLowerCase();
}

function isDiscoverableProjectPath(path: string): boolean {
  return !isProjectContainerPath(path);
}

function isProjectContainerPath(path: string): boolean {
  const home = homedir();
  const paths = pathVariants(path);
  const homePaths = pathVariants(home);
  if (paths.some((p) => homePaths.includes(p))) return true;

  const trashPaths = pathVariants(join(home, ".Trash"));
  if (paths.some((p) => trashPaths.some((trash) => isSameOrDescendant(p, trash)))) return true;

  // Paths under the user's home are valid project candidates unless they were
  // rejected above. This keeps VS Code recents under $HOME from being filtered.
  if (paths.some((p) => homePaths.some((h) => isSameOrDescendant(p, h)))) return false;

  // Outside home, skip broad system/container trees.
  const skipTrees = ["/tmp", "/private/tmp", "/var", "/private/var", "/usr", "/System"];
  return paths.some((p) => skipTrees.some((s) => isSameOrDescendant(p, s)));
}

function pathVariants(path: string): string[] {
  const variants = new Set([resolve(path)]);
  try {
    variants.add(realpathSync(path));
  } catch {
    // Non-existent path; resolved form is enough for prefix checks.
  }
  return [...variants];
}

function isSameOrDescendant(path: string, parent: string): boolean {
  return path === parent || path.startsWith(parent.endsWith("/") ? parent : parent + "/");
}

function deriveProjectName(projectPath: string): string {
  // Try package.json
  const pkgPath = join(projectPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.name && typeof pkg.name === "string") {
        return pkg.name.replace(/^@[^/]+\//, ""); // strip scope
      }
    } catch {
      // fall through
    }
  }

  // Try Cargo.toml
  const cargoPath = join(projectPath, "Cargo.toml");
  if (existsSync(cargoPath)) {
    try {
      const cargo = readFileSync(cargoPath, "utf-8");
      const match = cargo.match(/^name\s*=\s*"([^"]+)"/m);
      if (match) return match[1];
    } catch {
      // fall through
    }
  }

  return basename(projectPath);
}

function getLastModified(projectPath: string): Date {
  try {
    // Check .git/HEAD modification time as proxy for recent activity
    const gitHead = join(projectPath, ".git", "HEAD");
    if (existsSync(gitHead)) {
      return statSync(gitHead).mtime;
    }
    return statSync(projectPath).mtime;
  } catch {
    return new Date(0);
  }
}

function hasProjectManifest(projectPath: string): boolean {
  const manifests = [
    "package.json", "Cargo.toml", "pyproject.toml", "go.mod",
    "Gemfile", "pom.xml", "build.gradle", "mix.exs",
  ];
  return manifests.some((m) => existsSync(join(projectPath, m)));
}

function uniqueSources(sources: ProjectSource[]): ProjectSource[] {
  return [...new Set(sources)];
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Main discovery function. Merges results from all sources,
 * deduplicates by resolved path, and returns sorted by confidence.
 */
export function discoverProjects(): DiscoveredProject[] {
  // Check cache first
  const cached = loadCache();
  if (cached) return cached.projects;

  // Phase 1: Scan git repos (primary source)
  const gitProjects = scanGitRepos();

  // Phase 2: Claude Code history
  const claudeHistory = scanClaudeCodeHistory();

  // Phase 3: VS Code recents
  const vsCodeRecents = scanVSCodeRecents();

  // Merge: add source tags to git projects, create new entries for non-git sources
  const merged = new Map<string, DiscoveredProject>();

  for (const [key, path] of gitProjects) {
    merged.set(key, {
      name: deriveProjectName(path),
      path,
      sources: ["git"],
      lastModified: getLastModified(path),
      hasManifest: hasProjectManifest(path),
    });
  }

  for (const [key, path] of claudeHistory) {
    if (merged.has(key)) {
      merged.get(key)!.sources = uniqueSources([...merged.get(key)!.sources, "claude-code"]);
    } else {
      merged.set(key, {
        name: deriveProjectName(path),
        path,
        sources: ["claude-code"],
        lastModified: getLastModified(path),
        hasManifest: hasProjectManifest(path),
      });
    }
  }

  for (const [key, path] of vsCodeRecents) {
    if (merged.has(key)) {
      merged.get(key)!.sources = uniqueSources([...merged.get(key)!.sources, "vscode"]);
    } else {
      merged.set(key, {
        name: deriveProjectName(path),
        path,
        sources: ["vscode"],
        lastModified: getLastModified(path),
        hasManifest: hasProjectManifest(path),
      });
    }
  }

  // Sort: more sources = higher confidence, then by recency
  const projects = Array.from(merged.values());
  projects.sort((a, b) => {
    const scoreA = a.sources.length + (a.hasManifest ? 0.5 : 0);
    const scoreB = b.sources.length + (b.hasManifest ? 0.5 : 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return b.lastModified.getTime() - a.lastModified.getTime();
  });

  // Cache results
  saveCache(projects);

  return projects;
}

/**
 * Determine which projects should be pre-selected.
 * Pre-select if: in Claude Code history, OR has recent git activity (30 days),
 * OR has a project manifest.
 */
export function shouldPreSelect(project: DiscoveredProject): boolean {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const isRecent = project.lastModified.getTime() > thirtyDaysAgo;
  const inClaudeHistory = project.sources.includes("claude-code");
  return inClaudeHistory || (isRecent && project.hasManifest);
}

/**
 * Force re-discovery, bypassing the cache.
 */
export function discoverProjectsFresh(): DiscoveredProject[] {
  // Clear cache
  try {
    unlinkSync(CACHED_PROJECTS_PATH);
  } catch {
    // ignore
  }
  return discoverProjects();
}
