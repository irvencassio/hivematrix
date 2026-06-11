import { readFileSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join, resolve } from "path";
import { DEFAULT_MEMORY_SETTINGS, type MemorySettings } from "@/lib/types";

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export function shortenHome(path: string): string {
  const home = homedir();
  return path === home ? "~" : path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

export function normalizeBrainRootDir(path: string | null | undefined): string {
  const raw = String(path ?? "").trim();
  if (!raw) return defaultBrainRootDir();
  const expanded = expandHome(raw);
  return isAbsolute(expanded) ? expanded : resolve(homedir(), expanded);
}

export function officialBrainRootDir(): string {
  return normalizeBrainRootDir(DEFAULT_MEMORY_SETTINGS.brainRootDir);
}

export function defaultBrainRootDir(): string {
  return officialBrainRootDir();
}

export function readHiveConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(homedir(), ".hive", "config.json"), "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function resolveMemorySettings(config: Record<string, unknown> = readHiveConfig()): MemorySettings {
  const raw = config.memory && typeof config.memory === "object"
    ? config.memory as Partial<MemorySettings>
    : {};
  return {
    enabled: raw.enabled !== false,
    brainRootDir: normalizeBrainRootDir(raw.brainRootDir ?? defaultBrainRootDir()),
  };
}

export function configuredBrainRootDir(): string | null {
  const settings = resolveMemorySettings();
  return settings.enabled ? settings.brainRootDir : null;
}

export function preferredBrainRootDir(brainRootDir?: string | null): string {
  return normalizeBrainRootDir(brainRootDir ?? configuredBrainRootDir() ?? defaultBrainRootDir());
}

export function brainDocPolicyText(brainRootDir?: string | null): string {
  const root = shortenHome(preferredBrainRootDir(brainRootDir));
  return [
    `- A "brain doc" is a durable memory markdown document stored under \`${root}\`.`,
    `- When creating or updating durable memory, write it under \`${root}\` and create subdirectories as needed to keep docs organized.`,
    `- In prompts, "brain doc" usually refers to a file somewhere under \`${root}\`.`,
  ].join("\n");
}
