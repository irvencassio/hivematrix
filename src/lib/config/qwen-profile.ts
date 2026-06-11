import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export type QwenLocation = "local" | "lan" | "public";
export type QwenProvider = "mlx" | "vllm" | "ollama" | "lmstudio";

export interface QwenModelConfig {
  modelId: string;
  endpoint: string;
  provider: QwenProvider;
  contextLimit: number;
}

export interface QwenProfile {
  location: QwenLocation;
  primary: QwenModelConfig;
  secondary: QwenModelConfig | null;
  thinkingEnabled: boolean;
  minDecodeRate: number;
  probeTimeoutMs: number;
}

const DEFAULT_CONTEXT_LIMIT = 32768;
const DEFAULT_MIN_DECODE_RATE = 15;
const DEFAULT_PROBE_TIMEOUT_MS = 60_000;

const DEFAULT_PRIMARY: QwenModelConfig = {
  modelId: "Qwen3-Coder-Next-80B-A3B",
  endpoint: "http://localhost:8080",
  provider: "mlx",
  contextLimit: 262144,
};

function coerceProvider(p: unknown): QwenProvider {
  if (p === "mlx" || p === "vllm" || p === "ollama" || p === "lmstudio") return p;
  return "mlx";
}

function parseModelConfig(raw: unknown, fallback: QwenModelConfig): QwenModelConfig {
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  return {
    modelId: typeof r.modelId === "string" && r.modelId ? r.modelId : fallback.modelId,
    endpoint: typeof r.endpoint === "string" && r.endpoint ? r.endpoint : fallback.endpoint,
    provider: coerceProvider(r.provider),
    contextLimit: typeof r.contextLimit === "number" && r.contextLimit > 0
      ? r.contextLimit
      : DEFAULT_CONTEXT_LIMIT,
  };
}

export function getQwenProfile(): QwenProfile | null {
  try {
    const config = JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
    const raw = config.qwen;
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;

    const location: QwenLocation =
      r.location === "local" || r.location === "lan" || r.location === "public"
        ? r.location
        : "local";

    const primary = parseModelConfig(r.primary, DEFAULT_PRIMARY);
    const secondary = r.secondary ? parseModelConfig(r.secondary, DEFAULT_PRIMARY) : null;

    return {
      location,
      primary,
      secondary,
      thinkingEnabled: r.thinkingEnabled !== false,
      minDecodeRate:
        typeof r.minDecodeRate === "number" && r.minDecodeRate > 0
          ? r.minDecodeRate
          : DEFAULT_MIN_DECODE_RATE,
      probeTimeoutMs:
        typeof r.probeTimeoutMs === "number" && r.probeTimeoutMs > 0
          ? r.probeTimeoutMs
          : DEFAULT_PROBE_TIMEOUT_MS,
    };
  } catch {
    return null;
  }
}

export function isQwenEndpointLocal(endpoint: string): boolean {
  try {
    const url = new URL(endpoint.trim());
    const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return h === "localhost" || h === "127.0.0.1" || h === "::1";
  } catch {
    return false;
  }
}
