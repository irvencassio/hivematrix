/**
 * Frontier provider enablement — operator on/off toggles for Claude and Codex,
 * independent of whether the CLI binary is installed on disk. Lives under
 * `providers` in ~/.hivematrix/config.json as `{ <id>: { enabled } }`.
 *
 * NOTE: this is a different config namespace concept than
 * `src/lib/config/providers.ts` (local/cloud *model* providers like
 * ollama/lmstudio/openai) — that module predates this one and owns the same
 * top-level `providers` config key for its own provider ids (ollama, mlx,
 * ...). The two never collide on keys ("claude"/"codex" vs
 * "ollama"/"lmstudio"/"mlx"/"vllm"/"nanai"/"openai"), but the module names
 * were kept separate to avoid confusion.
 */

import { readFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { writeJsonAtomic } from "./atomic-write";
import { findBinary, CLAUDE_BINARY_SEARCH_PATHS, CODEX_BINARY_SEARCH_PATHS } from "./binary-detection";
import type { FrontierProvider } from "@/lib/models/available";

export type FrontierProviderId = FrontierProvider;

/** The single ordered list every hardcoded two-provider site should iterate. */
export const FRONTIER_PROVIDERS: FrontierProviderId[] = ["claude", "codex"];

interface ProviderEnablementConfig {
  enabled?: boolean;
}

function configPath(): string {
  const dir = join(homedir(), ".hivematrix");
  mkdirSync(dir, { recursive: true });
  return join(dir, "config.json");
}

function readConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(configPath(), "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readProvidersBlock(config: Record<string, unknown>): Record<string, ProviderEnablementConfig> {
  const raw = config.providers;
  return raw && typeof raw === "object" ? (raw as Record<string, ProviderEnablementConfig>) : {};
}

function binaryDetected(id: FrontierProviderId): boolean {
  if (id === "claude") return !!findBinary("claude", CLAUDE_BINARY_SEARCH_PATHS);
  if (id === "codex") return !!findBinary("codex", CODEX_BINARY_SEARCH_PATHS);
  return false;
}

/**
 * Default when the key is absent: enabled iff the binary is currently
 * detected (first-run behavior matches today's binary-presence gating).
 * Once the operator has explicitly toggled, the stored value wins regardless
 * of detection — a disabled-but-installed provider stays hidden.
 *
 * `detect` is injectable for tests; defaults to the real binary probe.
 */
export function isProviderEnabled(
  id: FrontierProviderId,
  config: Record<string, unknown> = readConfig(),
  detect: (id: FrontierProviderId) => boolean = binaryDetected,
): boolean {
  const entry = readProvidersBlock(config)[id];
  if (entry && typeof entry.enabled === "boolean") return entry.enabled;
  return detect(id);
}

/** Atomic merge write — copies the features.ts setFeature pattern. */
export function setProviderEnabled(id: FrontierProviderId, enabled: boolean): void {
  const config = readConfig();
  const providers = readProvidersBlock(config);
  providers[id] = { ...providers[id], enabled };
  config.providers = providers;
  writeJsonAtomic(configPath(), config);
}

export function getEnabledProviders(
  config: Record<string, unknown> = readConfig(),
  detect: (id: FrontierProviderId) => boolean = binaryDetected,
): FrontierProviderId[] {
  return FRONTIER_PROVIDERS.filter((id) => isProviderEnabled(id, config, detect));
}
