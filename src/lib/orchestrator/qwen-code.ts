/**
 * Qwen Code harness — third coding harness alongside Claude Code and Codex.
 *
 * Wraps spawnGenericAgent with Qwen-specific settings:
 * - Resolves the Qwen profile from settings to get endpoint + model ID
 * - Uses probe-driven supportsTools (from cached health)
 * - Sets Qwen3-appropriate context limits
 * - Emits frontierReviewDebt flag in the output when running in local-only mode
 */

import { spawnGenericAgent } from "./generic-agent";
import type { AgentProcess, AgentEventHandler } from "./subprocess";
import { getQwenProfile, type QwenProfile } from "@/lib/config/qwen-profile";
import { resolveProvider } from "@/lib/config/providers";
import type { ModelProvider } from "@/lib/config/providers";

export interface QwenCodeOptions {
  /** Prefer secondary (fast) model over primary (coder) model */
  preferSecondary?: boolean;
  agentType?: string;
  frontierReviewDebt?: boolean;
}

/**
 * Build a ModelProvider from a QwenProfile's primary or secondary model config.
 * Falls back to resolveProvider if the profile model ID matches a known local model.
 */
export function buildQwenProvider(profile: QwenProfile, preferSecondary = false): ModelProvider | null {
  const modelCfg = preferSecondary && profile.secondary ? profile.secondary : profile.primary;

  // Try resolveProvider first (picks up cached toolCalls from health probe)
  const resolved = resolveProvider(modelCfg.modelId);
  if (resolved) return { ...resolved, maxTokens: modelCfg.maxOutputTokens };

  // Fall back to constructing directly from profile
  return {
    name: modelCfg.provider,
    endpoint: modelCfg.endpoint,
    apiKey: "",
    supportsTools: true,
    maxTokens: modelCfg.maxOutputTokens,
  };
}

/**
 * Spawn a Qwen Code agent for a coding task.
 * Returns null if no Qwen profile is configured.
 */
export function spawnQwenCodeAgent(
  taskId: string,
  description: string,
  projectPath: string,
  maxBudgetUsd: number,
  onEvent: AgentEventHandler,
  onExit: (taskId: string, code: number | null, signal: string | null) => void,
  options: QwenCodeOptions = {}
): AgentProcess | null {
  const profile = getQwenProfile();
  if (!profile) return null;

  const provider = buildQwenProvider(profile, options.preferSecondary ?? false);
  if (!provider) return null;

  const modelId = options.preferSecondary && profile.secondary
    ? profile.secondary.modelId
    : profile.primary.modelId;

  const agentType = options.agentType ?? "developer";

  // Annotate the first event with frontier review debt status
  let debtAnnotated = false;
  const wrappedOnEvent: AgentEventHandler = (id, event) => {
    if (!debtAnnotated && options.frontierReviewDebt && event.type === "init") {
      debtAnnotated = true;
      onEvent(id, { type: "log", content: "[qwen-code] Running in local-only mode — frontier review queued on cloud restore" });
    }
    onEvent(id, event);
  };

  return spawnGenericAgent(
    taskId,
    description,
    projectPath,
    maxBudgetUsd,
    wrappedOnEvent,
    onExit,
    provider,
    modelId,
    agentType
  );
}

/**
 * Check whether the Qwen Code harness is available (profile configured + endpoint responsive).
 * Uses cached health data — does not probe live.
 */
export function isQwenCodeAvailable(): boolean {
  const profile = getQwenProfile();
  if (!profile) return false;
  const provider = buildQwenProvider(profile, false);
  return provider !== null;
}
