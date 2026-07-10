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
import { readConfigMatchedLocalModelHealth } from "@/lib/local-model/health";
import { isProviderEnabled } from "@/lib/config/frontier-providers";
import { getLocalEngineConfig, isLocalEngineEnabled } from "./local-engine";

export type BackendId = "local" | "claude" | "codex";

export interface BackendStatus {
  id: BackendId;
  name: string;
  /** installed && enabled — the historical meaning; every existing gate reads this. */
  configured: boolean;
  /** Binary found on disk, independent of the operator's enable/disable toggle. */
  installed: boolean;
  /** Operator's HiveMatrix-side enable/disable toggle. */
  enabled: boolean;
  detail: string;
  /** Shown when not configured — how to install/connect it. */
  connect?: string;
  /** For local: the concrete model id + endpoint when configured. */
  endpoint?: string;
  modelId?: string;
}

/** Injectable for tests — real binary/config lookups are process-global and hard to sandbox. */
export interface DetectBackendsEnv {
  findBinary?: typeof findBinary;
  isProviderEnabled?: typeof isProviderEnabled;
  isLocalEngineEnabled?: typeof isLocalEngineEnabled;
}

export function detectBackends(env: DetectBackendsEnv = {}): BackendStatus[] {
  const find = env.findBinary ?? findBinary;
  const enabled = env.isProviderEnabled ?? isProviderEnabled;
  const localEnabled = env.isLocalEngineEnabled ?? isLocalEngineEnabled;
  const out: BackendStatus[] = [];

  // Local server — engine label reflects the configured local engine
  // (Rapid-MLX is the chosen default; LM Studio / Ollama remain alternates).
  const qwen = getQwenProfile();
  const local = getLocalModelConfig();
  const engine = getLocalEngineConfig().engine;
  const localProvider = qwen?.primary.provider ?? local?.provider ?? null;
  const engineName = localProvider === "vllm" ? "vLLM"
    : localProvider === "mlx" || engine === "rapid-mlx" ? "Rapid-MLX"
    : localProvider === "ollama" || engine === "ollama" ? "Ollama"
    : "LM Studio";
  const localModelId = qwen?.primary.modelId ?? local?.modelName ?? null;
  const localEndpoint = qwen?.primary.endpoint ?? local?.endpoint
    ?? (engine === "rapid-mlx" ? "http://127.0.0.1:8000/v1" : "http://localhost:1234/v1");
  const health = readConfigMatchedLocalModelHealth();
  const localConfigured = !!localModelId;
  const localEngineEnabled = localEnabled();
  out.push({
    id: "local",
    name: `Local server (${engineName})`,
    configured: localConfigured && localEngineEnabled,
    installed: localConfigured,
    enabled: localEngineEnabled,
    detail: localConfigured
      ? `${localModelId} @ ${localEndpoint}${health?.ready ? " (healthy)" : ""}`
      : "no local model configured",
    connect: localConfigured ? undefined
      : engine === "rapid-mlx"
        ? "Start Rapid-MLX (rapid-mlx serve <model> --no-thinking) and set config.qwen.primary (modelId + endpoint)."
        : "Run the local server, load a model, and set config.qwen.primary (modelId + endpoint).",
    endpoint: localConfigured ? localEndpoint : undefined,
    modelId: localModelId ?? undefined,
  });

  // Claude Code CLI
  const claudePath = find("claude", CLAUDE_BINARY_SEARCH_PATHS);
  const claudeInstalled = !!claudePath;
  const claudeEnabled = enabled("claude");
  out.push({
    id: "claude",
    name: "Claude Code",
    configured: claudeInstalled && claudeEnabled,
    installed: claudeInstalled,
    enabled: claudeEnabled,
    detail: claudeInstalled ? `claude CLI at ${claudePath}` : "claude CLI not found",
    connect: claudeInstalled ? undefined : "Install Claude Code (https://claude.com/claude-code) and run `claude` once to sign in.",
  });

  // Codex CLI
  const codexPath = find("codex", CODEX_BINARY_SEARCH_PATHS);
  const codexInstalled = !!codexPath;
  const codexEnabled = enabled("codex");
  out.push({
    id: "codex",
    name: "Codex",
    configured: codexInstalled && codexEnabled,
    installed: codexInstalled,
    enabled: codexEnabled,
    detail: codexInstalled ? `codex CLI at ${codexPath}` : "codex CLI not found",
    connect: codexInstalled ? undefined : "Install the Codex CLI and run `codex login` (ChatGPT subscription).",
  });

  return out;
}

export function backendConfigured(id: BackendId): boolean {
  return detectBackends().find((b) => b.id === id)?.configured ?? false;
}
