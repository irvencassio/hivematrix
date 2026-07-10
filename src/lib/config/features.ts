/**
 * Feature flags in settings — toggles for optional integrations (e.g. Azure
 * DevOps). Flags live under `features` in ~/.hivematrix/config.json; reading is
 * pure-ish and a setter merges one flag without disturbing the rest of config.
 */

import { readFileSync, mkdirSync } from "fs";
import { homedir, arch, totalmem } from "os";
import { join } from "path";
import { writeJsonAtomic } from "./atomic-write";

/** Known feature flags. Add a row to surface a new toggle in settings. */
export const KNOWN_FEATURES = [
  { key: "ado", label: "Azure DevOps", description: "Register the Azure DevOps MCP server so agents can operate repos, PRs, pipelines, and work items." },
  { key: "voice", label: "Voice Lane", description: "Live voice conversation, phone-answering, and spoken replies in the Kokoro voice. Advanced — runs the local voice sidecar." },
  { key: "openclaw.chatDock", label: "OpenClaw Chat", description: "Show OpenClaw chat as a center-pane workspace in the HiveMatrix console. OpenClaw must be installed and its Gateway must be reachable on this Mac." },
  { key: "promptWizardAlways", label: "Always enhance new tasks", description: "Run the New Task prompt wizard automatically before every Create — you still review and accept the rewrite. Off by default; you can still enhance manually with the ✨ button." },
  { key: "agentSpecialization", label: "Specialist agents", description: "Route each task to a specialist role (developer, QA, designer, COO…) instead of always using the developer role. Off = every task runs as developer." },
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

// Features that run heavy local models (Apple Silicon + RAM). The voice pipeline
// needs MLX (whisper + Kokoro TTS), so it's gated; the UI greys the toggle out on
// machines that can't run it.
const HEAVY_FEATURES = new Set<string>(["voice"]);
const MIN_RAM_GB = 16;

export interface FeatureCapability { capable: boolean; reason?: string }

export function shouldShowFeature(
  key: string,
  env: { openclawInstalled?: boolean } = {},
): boolean {
  if (key === "openclaw.chatDock" && env.openclawInstalled === false) return false;
  return true;
}

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
  writeJsonAtomic(configPath(), config);
  return parseFeatures(config);
}
