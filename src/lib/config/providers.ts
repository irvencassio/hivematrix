import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { readCachedLocalModelHealth } from "@/lib/local-model/health";

// Direct cloud image provider removed. nanai retained as abstract image provider for Nano Banana.
// TODO Phase 2: mlx supportsTools must be probe-driven via the readiness gate, not hardcoded false.

export interface ModelProvider {
  name: string;
  endpoint: string;
  apiKey: string;
  supportsTools: boolean;
  maxTokens: number;
}

export interface ProviderConfig {
  apiKey?: string;
  endpoint?: string;
  enabled?: boolean;
}

// Built-in provider defaults — endpoint and capabilities
const PROVIDER_DEFAULTS: Record<string, { endpoint: string; supportsTools: boolean; maxTokens: number }> = {
  ollama: {
    endpoint: "http://localhost:11434/v1",
    supportsTools: true,
    maxTokens: 4096,
  },
  lmstudio: {
    endpoint: "http://localhost:1234/v1",
    supportsTools: true,
    maxTokens: 4096,
  },
  mlx: {
    endpoint: "http://localhost:8080/v1",
    supportsTools: false,
    maxTokens: 4096,
  },
  vllm: {
    endpoint: "http://localhost:8000/v1",
    supportsTools: true,
    maxTokens: 4096,
  },
  nanai: {
    endpoint: "",
    supportsTools: true,
    maxTokens: 4096,
  },
  openai: {
    endpoint: "https://api.openai.com/v1",
    supportsTools: true,
    maxTokens: 4096,
  },
};

// Model ID → provider name mapping (prefix match)
const MODEL_PROVIDER_MAP: [string, string][] = [
  ["gpt-", "openai"],
  ["o1", "openai"],
  ["o3", "openai"],
  ["o4", "openai"],
];

/**
 * Read provider configs from ~/.hivematrix/config.json
 */
function getProviderConfigs(): Record<string, ProviderConfig> {
  try {
    const config = JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
    return config.providers ?? {};
  } catch {
    return {};
  }
}

function getLocalModelConfig(): { provider?: string; endpoint?: string; modelName?: string } | null {
  try {
    const config = JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
    if (!config.localModel || typeof config.localModel !== "object") return null;
    return config.localModel as { provider?: string; endpoint?: string; modelName?: string };
  } catch {
    return null;
  }
}

/**
 * Detect which provider a model belongs to based on its ID.
 */
export function detectProvider(modelId: string): string | null {
  for (const [prefix, provider] of MODEL_PROVIDER_MAP) {
    if (modelId.startsWith(prefix)) return provider;
  }
  const localModel = getLocalModelConfig();
  if (localModel?.modelName === modelId) {
    const provider = localModel.provider;
    if (provider === "ollama" || provider === "lmstudio" || provider === "mlx" || provider === "vllm" || provider === "nanai") {
      return provider;
    }
  }
  return null;
}

/**
 * Resolve a full ModelProvider for a given model ID.
 * Returns null if no provider is configured or the model is a Claude model.
 */
export function resolveProvider(modelId: string): ModelProvider | null {
  if (modelId.startsWith("claude-")) return null;

  const providerName = detectProvider(modelId);
  if (!providerName) return null;

  const defaults = PROVIDER_DEFAULTS[providerName];
  const configs = getProviderConfigs();
  const userConfig = configs[providerName];
  const localModel = getLocalModelConfig();

  if (!defaults && !userConfig) return null;

  const endpoint = localModel?.modelName === modelId
    ? localModel.endpoint
    : (userConfig?.endpoint ?? defaults?.endpoint);
  if (!endpoint) return null;

  // API key: env vars only — Hive does not store keys
  const envKeyMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
  };
  const apiKey = process.env[envKeyMap[providerName] ?? ""] ?? "";

  // Cloud providers require an API key
  const isLocal = providerName === "ollama" || providerName === "lmstudio" || providerName === "mlx" || providerName === "vllm" || providerName === "nanai";
  if (!isLocal && !apiKey) return null;

  const localHealth = isLocal ? readCachedLocalModelHealth() : null;
  const supportsTools = localHealth &&
    localHealth.endpoint === endpoint &&
    localHealth.modelName === modelId &&
    localHealth.provider === providerName
      ? localHealth.toolCalls
      : defaults?.supportsTools ?? true;

  return {
    name: providerName,
    endpoint,
    apiKey,
    supportsTools,
    maxTokens: defaults?.maxTokens ?? 4096,
  };
}
