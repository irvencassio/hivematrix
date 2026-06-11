import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { BUILTIN_SYSTEM_PROJECTS, DEFAULT_TASK_PROJECT, LEGACY_SYSTEM_PROJECTS, VIRTUAL_PERSONAL_PROJECTS } from "./project-constants";

const CUSTOM_PROJECTS_PATH = join(homedir(), ".hivematrix", "projects.json");

// Builtin aliases are loaded from ~/.hive/aliases.json if present.
// Auto-discovery of git repos in $HOME covers most cases.
// Users add custom aliases via ~/.hive/projects.json.
function loadBuiltinAliases(): Record<string, string> {
  try {
    const aliasPath = join(homedir(), ".hivematrix", "aliases.json");
    const data = readFileSync(aliasPath, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

const BUILTIN_ALIASES: Record<string, string> = loadBuiltinAliases();

function loadCustomProjects(): Record<string, string> {
  try {
    const data = readFileSync(CUSTOM_PROJECTS_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export function saveCustomProject(name: string, path: string) {
  const custom = loadCustomProjects();
  custom[name.toLowerCase().trim()] = path;
  mkdirSync(join(homedir(), ".hivematrix"), { recursive: true });
  writeFileSync(CUSTOM_PROJECTS_PATH, JSON.stringify(custom, null, 2));
}

export function removeProject(name: string) {
  const custom = loadCustomProjects();
  delete custom[name.toLowerCase().trim()];
  mkdirSync(join(homedir(), ".hivematrix"), { recursive: true });
  writeFileSync(CUSTOM_PROJECTS_PATH, JSON.stringify(custom, null, 2));
}

export function saveAllProjects(projects: Record<string, string>) {
  mkdirSync(join(homedir(), ".hivematrix"), { recursive: true });
  writeFileSync(CUSTOM_PROJECTS_PATH, JSON.stringify(projects, null, 2));
}

export function getAllProjects(): Record<string, string> {
  return { ...BUILTIN_ALIASES, ...loadCustomProjects() };
}

// Keep this export for backward compatibility — now dynamic
export const PROJECT_ALIASES = getAllProjects();

// Projects that don't participate in repo locking (multiple can run concurrently)
export const NO_REPO_LOCK_PROJECTS = new Set([DEFAULT_TASK_PROJECT, ...LEGACY_SYSTEM_PROJECTS]);

export function resolveProject(alias: string): string | null {
  const key = alias.trim();
  const lower = key.toLowerCase();
  const all = getAllProjects();
  // Exact match first, then case-insensitive fallback for chat-originated names.
  if (all[key]) return all[key];
  for (const [k, v] of Object.entries(all)) {
    if (k.toLowerCase() === lower) return v;
  }
  if (BUILTIN_SYSTEM_PROJECTS.has(lower)) return homedir();
  if (VIRTUAL_PERSONAL_PROJECTS.has(lower)) return homedir();
  return null;
}

export function parseProjectFromMessage(message: string): {
  project: string | null;
  task: string;
} {
  // Pattern: "in <project>, <task>" or "<project>: <task>"
  const inMatch = message.match(/^in\s+(\S+)[,:]?\s+(.+)$/i);
  if (inMatch) {
    return { project: inMatch[1].toLowerCase(), task: inMatch[2] };
  }

  const colonMatch = message.match(/^(\S+):\s+(.+)$/);
  if (colonMatch && PROJECT_ALIASES[colonMatch[1].toLowerCase()]) {
    return { project: colonMatch[1].toLowerCase(), task: colonMatch[2] };
  }

  return { project: null, task: message };
}
