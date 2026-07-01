/**
 * Feature flags in settings — toggles for optional integrations (e.g. Azure
 * DevOps). Flags live under `features` in ~/.hivematrix/config.json; reading is
 * pure-ish and a setter merges one flag without disturbing the rest of config.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir, arch, totalmem } from "os";
import { join } from "path";

/** Known feature flags. Add a row to surface a new toggle in settings. */
export const KNOWN_FEATURES = [
  { key: "ado", label: "Azure DevOps", description: "Register the Azure DevOps MCP server so agents can operate repos, PRs, pipelines, and work items." },
  { key: "voice", label: "Voice Lane", description: "Live voice conversation, phone-answering, and spoken replies in your cloned voice. Advanced — runs the local voice sidecar." },
  { key: "video", label: "Video factory", description: "Turn a script or topic into a narrated, captioned how-to/explainer video in your cloned voice. Advanced — runs the local video pipeline." },
  { key: "taskIntakeModelDecomposition", label: "Smarter task breakdown", description: "Use a local model (or your keyless ChatGPT/Codex CLI session) to split broad requests into cleaner Work Package steps. HiveMatrix still decides risk, gating, and concurrency. Off by default." },
  { key: "openclaw.chatDock", label: "OpenClaw Chat", description: "Show OpenClaw chat as a center-pane workspace in the HiveMatrix console. OpenClaw must be installed and its Gateway must be reachable on this Mac." },
] as const;

export type FeatureKey = (typeof KNOWN_FEATURES)[number]["key"];

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

/** Parse the `features` block of a config object. Pure. */
export function parseFeatures(config: Record<string, unknown>): Record<string, boolean> {
  const raw = config.features;
  const out: Record<string, boolean> = {};
  if (raw && typeof raw === "object") {
    for (const f of KNOWN_FEATURES) out[f.key] = (raw as Record<string, unknown>)[f.key] === true;
  } else {
    for (const f of KNOWN_FEATURES) out[f.key] = false;
  }
  return out;
}

// Features that run heavy local models (Apple Silicon + RAM). The voice/video
// pipelines need MLX (whisper + cloned-voice TTS + the video stack), so they're
// gated; the UI greys the toggle out on machines that can't run them.
const HEAVY_FEATURES = new Set<string>(["voice", "video"]);
const MIN_RAM_GB = 16;

export interface FeatureCapability { capable: boolean; reason?: string }

/** Can this machine run the feature? `env` is injectable for tests. */
export function featureCapability(
  key: string,
  env: { arch?: string; ramGB?: number } = {},
): FeatureCapability {
  if (!HEAVY_FEATURES.has(key)) return { capable: true };
  const a = env.arch ?? arch();
  if (a !== "arm64") return { capable: false, reason: "Requires an Apple Silicon Mac" };
  const gb = env.ramGB ?? totalmem() / 1e9;
  if (gb < MIN_RAM_GB) return { capable: false, reason: `Requires ${MIN_RAM_GB} GB+ RAM (this Mac has ${Math.round(gb)} GB)` };
  return { capable: true };
}

export function getFeatureFlags(): Record<string, boolean> {
  return parseFeatures(readConfig());
}

export function isFeatureEnabled(key: FeatureKey): boolean {
  return getFeatureFlags()[key] === true;
}

/** Toggle one feature flag (merges into config.json, preserving everything else). */
export function setFeature(key: FeatureKey, enabled: boolean): Record<string, boolean> {
  const config = readConfig();
  const features = (config.features && typeof config.features === "object" ? config.features : {}) as Record<string, unknown>;
  features[key] = enabled;
  config.features = features;
  writeFileSync(configPath(), JSON.stringify(config, null, 2));
  return parseFeatures(config);
}
