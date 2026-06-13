/**
 * Resolve an abstract ModelTier to a concrete model ID from settings.
 *
 * The router decides a tier (frontier / local-primary / local-secondary / nanai
 * / unavailable) from role + connectivity. This module is the single place that
 * turns a tier into the actual model string a task carries — reading the Qwen
 * profile for local tiers, the configured frontier favorite for frontier, and
 * the Nano Banana catalog entry for images. No model IDs are hard-coded in the
 * router or the directive engine.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ModelTier } from "@/lib/connectivity/policy";
import { getQwenProfile } from "@/lib/config/qwen-profile";

const DEFAULT_FRONTIER = "claude-sonnet-4-6"; // Q3: Claude is the shipped default
const DEFAULT_FRONTIER_PREMIUM = "claude-opus-4-8"; // think/planning → Opus
const DEFAULT_FRONTIER_CODEX = "codex:gpt-5.5-codex"; // Codex provider alternative
const NANO_BANANA = "nano-banana";

function readConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Concrete model ID for a tier, or null if no model is configured for it.
 * `unavailable` always returns null (caller should queue/skip).
 */
export function resolveModelId(tier: ModelTier): string | null {
  switch (tier) {
    case "frontier-premium": {
      const cfg = readConfig();
      if (cfg.frontierProvider === "codex") return DEFAULT_FRONTIER_CODEX;
      const m = (cfg.thinkModel as string | undefined)?.trim();
      return m || DEFAULT_FRONTIER_PREMIUM;
    }
    case "frontier": {
      const cfg = readConfig();
      if (cfg.frontierProvider === "codex") return DEFAULT_FRONTIER_CODEX;
      const fav = (cfg.frontierModel as string | undefined)?.trim();
      return fav || DEFAULT_FRONTIER;
    }
    case "local-primary": {
      const profile = getQwenProfile();
      return profile?.primary.modelId ?? null;
    }
    case "local-secondary": {
      const profile = getQwenProfile();
      return profile?.secondary?.modelId ?? profile?.primary.modelId ?? null;
    }
    case "nanai":
      return NANO_BANANA;
    case "unavailable":
    default:
      return null;
  }
}
