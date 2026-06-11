import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { delimiter, isAbsolute, join } from "path";
import { homedir } from "os";

export const CODEX_BINARY_SEARCH_PATHS = [
  "/usr/local/bin/codex",
  "/opt/homebrew/bin/codex",
  join(homedir(), ".npm-global", "bin", "codex"),
  join(homedir(), ".local", "bin", "codex"),
];

export const CLAUDE_BINARY_SEARCH_PATHS = [
  "/usr/local/bin/claude",
  "/opt/homebrew/bin/claude",
  join(homedir(), ".npm-global", "bin", "claude"),
  join(homedir(), ".claude", "bin", "claude"),
  join(homedir(), ".local", "bin", "claude"),
];

export function buildCliPath(existingPath = process.env.PATH ?? ""): string {
  const entries = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(homedir(), ".local", "bin"),
    join(homedir(), ".npm-global", "bin"),
    "/usr/bin",
    "/bin",
    ...existingPath.split(delimiter),
  ].filter(Boolean);

  return Array.from(new Set(entries)).join(delimiter);
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export function splitCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

function resolvePathCandidate(candidate: string): string | null {
  const expanded = expandHome(candidate);
  if ((isAbsolute(expanded) || candidate.includes("/")) && existsSync(expanded)) {
    return expanded;
  }
  return null;
}

export function findBinary(name: string, searchPaths: string[] = []): string | null {
  const direct = resolvePathCandidate(name);
  if (direct) return direct;

  try {
    const result = execFileSync("which", [name], {
      encoding: "utf-8",
      env: { ...process.env, PATH: buildCliPath() },
      timeout: 3000,
    }).trim();
    const first = result.split("\n")[0];
    if (first && existsSync(first)) return first;
  } catch {
    // not on PATH
  }

  for (const candidate of searchPaths) {
    const resolved = resolvePathCandidate(candidate);
    if (resolved) return resolved;
  }

  return null;
}

export function detectBinary(options: {
  name: string;
  configuredPath?: string;
  configuredCommand?: string;
  searchPaths?: string[];
}): boolean {
  if (options.configuredPath && resolvePathCandidate(options.configuredPath)) return true;

  if (options.configuredCommand?.trim()) {
    const [binary] = splitCommand(options.configuredCommand);
    if (binary && findBinary(binary, options.searchPaths)) return true;
  }

  return Boolean(findBinary(options.name, options.searchPaths));
}
