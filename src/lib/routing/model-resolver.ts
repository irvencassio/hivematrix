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
import { CLAUDE_OPUS_ID, CLAUDE_SONNET_ID, CODEX_NEWEST_ID, CODEX_SPARK_ID } from "@/lib/models/available";

const NANO_BANANA = "nano-banana";

export interface ResolveModelOptions {
  /** Ignore local/non-frontier role overrides, used by Cloud-only posture. */
  noLocalOverrides?: boolean;
}

function readConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
  } catch {
    return {};
  }
}

function isFrontierOverride(modelId: string): boolean {
  return /^(claude-|codex:|gpt-|o[0-9]|opus$|sonnet$|haiku$)/i.test(modelId);
}

/**
 * Concrete model ID for a tier, or null if no model is configured for it.
 * `unavailable` always returns null (caller should queue/skip).
 */
export function resolveModelId(tier: ModelTier, options: ResolveModelOptions = {}): string | null {
  switch (tier) {
    case "frontier-premium": {
      const cfg = readConfig();
      const m = (cfg.thinkModel as string | undefined)?.trim();
      if (m && (!options.noLocalOverrides || isFrontierOverride(m))) return m;
      return cfg.frontierProvider === "codex" ? CODEX_NEWEST_ID : CLAUDE_OPUS_ID;
    }
    case "frontier": {
      const cfg = readConfig();
      const fav = (cfg.frontierModel as string | undefined)?.trim();
      if (fav && (!options.noLocalOverrides || isFrontierOverride(fav))) return fav;
      return cfg.frontierProvider === "codex" ? CODEX_SPARK_ID : CLAUDE_SONNET_ID;
    }
    case "local-primary": {
      const profile = getQwenProfile();
      return profile?.primary.modelId ?? null;
    }
    case "local-secondary": {
      // Operator override (Settings → Models → operational role) wins, then the
      // Qwen profile's secondary, then its primary.
      const op = (readConfig().operationalModel as string | undefined)?.trim();
      if (op) return op;
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
