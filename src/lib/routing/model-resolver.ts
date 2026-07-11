/**
 * Resolve an abstract ModelTier to a concrete model ID from settings.
 *
 * The router decides a tier (frontier / operational / nanai / unavailable)
 * from role + connectivity. This module is the single place that turns a tier
 * into the actual model string a task carries — reading the operational
 * override or Haiku default for the operational tier, the configured frontier
 * favorite for frontier, and the Nano Banana catalog entry for images. No
 * model IDs are hard-coded in the router or the directive engine.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ModelTier } from "@/lib/connectivity/policy";
import { CLAUDE_OPUS_ID, CLAUDE_SONNET_ID, CLAUDE_HAIKU_ID, CODEX_NEWEST_ID, CODEX_SPARK_ID } from "@/lib/models/available";
import { detectBackends, type BackendStatus } from "@/lib/models/backends";

const NANO_BANANA = "nano-banana";

export interface ResolveModelOptions {
  /** Ignore local/non-frontier role overrides, used by Cloud-only posture. */
  noLocalOverrides?: boolean;
  /** Injectable for tests; production detects the installed CLI backends. */
  frontierBackends?: BackendStatus[];
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

function backendConfigured(backends: BackendStatus[], id: "claude" | "codex"): boolean {
  return backends.some((b) => b.id === id && b.configured);
}

function availableFrontierProvider(cfg: Record<string, unknown>, backends: BackendStatus[]): "claude" | "codex" | null {
  const hasClaude = backendConfigured(backends, "claude");
  const hasCodex = backendConfigured(backends, "codex");
  const preferred = cfg.frontierProvider === "codex" ? "codex" : "claude";
  if (preferred === "codex" && hasCodex) return "codex";
  if (preferred === "claude" && hasClaude) return "claude";
  if (hasClaude) return "claude";
  if (hasCodex) return "codex";
  return null;
}

function modelSupportedByBackends(modelId: string, backends: BackendStatus[]): boolean {
  if (/^codex:|^gpt-|^o[0-9]/i.test(modelId)) return backendConfigured(backends, "codex");
  if (/^claude-|^opus$|^sonnet$|^haiku$/i.test(modelId)) return backendConfigured(backends, "claude");
  return true;
}

/**
 * Concrete model ID for a tier, or null if no model is configured for it.
 * `unavailable` always returns null (caller should queue/skip).
 */
export function resolveModelId(tier: ModelTier, options: ResolveModelOptions = {}): string | null {
  switch (tier) {
    case "frontier-premium": {
      const cfg = readConfig();
      const backends = options.frontierBackends ?? detectBackends();
      const m = (cfg.thinkModel as string | undefined)?.trim();
      if (m && (!options.noLocalOverrides || isFrontierOverride(m)) && modelSupportedByBackends(m, backends)) return m;
      const provider = availableFrontierProvider(cfg, backends);
      if (provider === "codex") return CODEX_NEWEST_ID;
      if (provider === "claude") return CLAUDE_OPUS_ID;
      return null;
    }
    case "frontier": {
      const cfg = readConfig();
      const backends = options.frontierBackends ?? detectBackends();
      const fav = (cfg.frontierModel as string | undefined)?.trim();
      if (fav && (!options.noLocalOverrides || isFrontierOverride(fav)) && modelSupportedByBackends(fav, backends)) return fav;
      const provider = availableFrontierProvider(cfg, backends);
      if (provider === "codex") return CODEX_SPARK_ID;
      if (provider === "claude") return CLAUDE_SONNET_ID;
      return null;
    }
    case "operational": {
      const cfg = readConfig();
      const backends = options.frontierBackends ?? detectBackends();
      const op = (cfg.operationalModel as string | undefined)?.trim();
      if (op && modelSupportedByBackends(op, backends)) return op;
      if (backendConfigured(backends, "claude")) return CLAUDE_HAIKU_ID;
      // Codex-only installs: fall back to the cheap Codex pool rather than null.
      if (backendConfigured(backends, "codex")) return CODEX_SPARK_ID;
      return null;
    }
    case "nanai":
      return NANO_BANANA;
    case "unavailable":
    default:
      return null;
  }
}
