/**
 * Model-backend detection for the Settings/New-Task UI.
 *
 * Reports which backends are actually set up on this machine so the console can
 * (a) only offer models whose backend is configured, and (b) show an
 * install/connect flow for the missing ones.
 *
 * Backends:
 *   local  — LM Studio (or other OpenAI-compatible) local server + a Qwen profile
 *   claude — the `claude` CLI (Claude Code)
 *   codex  — the `codex` CLI (OpenAI Codex)
 */

import { findBinary, CLAUDE_BINARY_SEARCH_PATHS, CODEX_BINARY_SEARCH_PATHS } from "@/lib/config/binary-detection";
import { getQwenProfile } from "@/lib/config/qwen-profile";
import { getLocalModelConfig } from "@/lib/config/constants";
import { readCachedLocalModelHealth } from "@/lib/local-model/health";

export type BackendId = "local" | "claude" | "codex";

export interface BackendStatus {
  id: BackendId;
  name: string;
  configured: boolean;
  detail: string;
  /** Shown when not configured — how to install/connect it. */
  connect?: string;
  /** For local: the concrete model id + endpoint when configured. */
  endpoint?: string;
  modelId?: string;
}

export function detectBackends(): BackendStatus[] {
  const out: BackendStatus[] = [];

  // Local server (LM Studio) — configured when a Qwen profile or localModel is set.
  const qwen = getQwenProfile();
  const local = getLocalModelConfig();
  const localModelId = qwen?.primary.modelId ?? local?.modelName ?? null;
  const localEndpoint = qwen?.primary.endpoint ?? local?.endpoint ?? "http://localhost:1234/v1";
  const health = readCachedLocalModelHealth();
  const localConfigured = !!localModelId;
  out.push({
    id: "local",
    name: "Local server (LM Studio)",
    configured: localConfigured,
    detail: localConfigured
      ? `${localModelId} @ ${localEndpoint}${health?.ready ? " (healthy)" : ""}`
      : "no local model configured",
    connect: localConfigured ? undefined : "Run LM Studio, load a model, and set config.qwen.primary (modelId + endpoint).",
    endpoint: localConfigured ? localEndpoint : undefined,
    modelId: localModelId ?? undefined,
  });

  // Claude Code CLI
  const claudePath = findBinary("claude", CLAUDE_BINARY_SEARCH_PATHS);
  out.push({
    id: "claude",
    name: "Claude Code",
    configured: !!claudePath,
    detail: claudePath ? `claude CLI at ${claudePath}` : "claude CLI not found",
    connect: claudePath ? undefined : "Install Claude Code (https://claude.com/claude-code) and run `claude` once to sign in.",
  });

  // Codex CLI
  const codexPath = findBinary("codex", CODEX_BINARY_SEARCH_PATHS);
  out.push({
    id: "codex",
    name: "Codex",
    configured: !!codexPath,
    detail: codexPath ? `codex CLI at ${codexPath}` : "codex CLI not found",
    connect: codexPath ? undefined : "Install the Codex CLI and run `codex login` (ChatGPT subscription).",
  });

  return out;
}

export function backendConfigured(id: BackendId): boolean {
  return detectBackends().find((b) => b.id === id)?.configured ?? false;
}
