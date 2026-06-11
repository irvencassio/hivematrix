import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { getLocalModelConfig, type LocalModelConfig } from "@/lib/config/constants";

export interface LocalFallbackSettings {
  enabled: boolean;
  offlineEnabled: boolean;
}

export interface LocalModelHealth {
  checkedAt: string;
  provider: LocalModelConfig["provider"];
  endpoint: string;
  modelName: string;
  ok: boolean;
  ready: boolean;
  modelFound: boolean;
  streaming: boolean;
  toolCalls: boolean;
  offlineReady: boolean;
  message: string;
  models: string[];
}

interface ProbeOptions extends LocalModelConfig {
  timeoutMs?: number;
  toolCallTimeoutMs?: number;
}

const HEALTH_FILE = join(homedir(), ".hive", "local-model-health.json");
const LOCAL_PROVIDER_SET = new Set(["ollama", "lmstudio", "mlx", "vllm", "nanai"]);
const DEFAULT_LOCAL_FALLBACK: LocalFallbackSettings = {
  enabled: true,
  offlineEnabled: true,
};

const g = globalThis as typeof globalThis & {
  __hiveLocalModelHealth?: LocalModelHealth | null;
  __hiveLocalModelHealthPromise?: Promise<LocalModelHealth | null> | null;
};

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function normalizeBaseUrl(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

function buildCandidateUrls(endpoint: string, path: string): string[] {
  const base = normalizeBaseUrl(endpoint);
  const urls = [`${base}/${path}`];
  if (!base.endsWith("/v1")) {
    urls.push(`${base}/v1/${path}`);
  }
  return urls;
}

function extractModels(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as { data?: unknown; models?: unknown };
  const rows = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return "";
      const value = (row as { id?: unknown; name?: unknown }).id ?? (row as { name?: unknown }).name;
      return typeof value === "string" ? value : "";
    })
    .filter(Boolean);
}

function buildHealthResult(
  config: LocalModelConfig,
  partial: Partial<LocalModelHealth> & Pick<LocalModelHealth, "message" | "ok">
): LocalModelHealth {
  const endpoint = normalizeBaseUrl(config.endpoint);
  let offlineReady = false;
  try {
    offlineReady = isLoopbackHost(new URL(endpoint).hostname);
  } catch {
    offlineReady = false;
  }
  const modelFound = partial.modelFound === true;
  const streaming = partial.streaming === true;
  const toolCalls = partial.toolCalls === true;
  const ready = modelFound && streaming && toolCalls;
  return {
    checkedAt: new Date().toISOString(),
    provider: config.provider,
    endpoint,
    modelName: config.modelName,
    ok: partial.ok,
    ready,
    modelFound,
    streaming,
    toolCalls,
    offlineReady,
    message: partial.message,
    models: partial.models ?? [],
  };
}

async function probeStreaming(endpoint: string, modelName: string, timeoutMs: number): Promise<boolean> {
  const body = {
    model: modelName,
    messages: [{ role: "user", content: "Reply with exactly PONG." }],
    stream: true,
    max_tokens: 16,
  };
  let lastError = "Streaming request failed";

  for (const url of buildCandidateUrls(endpoint, "chat/completions")) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok || !res.body) {
        lastError = !res.ok ? `HTTP ${res.status}` : "No response body";
        continue;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawEvent = false;
      let sawText = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]") {
            if (sawEvent) return true;
            continue;
          }
          const payload = JSON.parse(dataStr) as { choices?: Array<Record<string, unknown>> };
          const choice = payload.choices?.[0];
          if (!choice) continue;
          sawEvent = true;
          const delta = choice.delta as Record<string, unknown> | undefined;
          if (typeof delta?.content === "string" && delta.content.trim()) {
            sawText = true;
          }
          const finishReason = choice.finish_reason;
          if (sawText || typeof finishReason === "string") {
            return true;
          }
        }
      }
      if (sawEvent) return true;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError);
}

// TODO Phase 2: flip mlx supportsTools to be probe-driven, not hardcoded
async function probeToolCalls(endpoint: string, modelName: string, timeoutMs: number): Promise<boolean> {
  const body = {
    model: modelName,
    stream: false,
    max_tokens: 512,
    temperature: 0,
    messages: [{ role: "user", content: "Call the ping tool with value pong. Do not explain anything. Use the tool." }],
    tools: [
      {
        type: "function",
        function: {
          name: "ping",
          description: "Return the supplied value.",
          parameters: {
            type: "object",
            properties: {
              value: { type: "string" },
            },
            required: ["value"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: "required",
  };
  let lastError = "Tool-call request failed";

  for (const url of buildCandidateUrls(endpoint, "chat/completions")) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const payload = await res.json() as {
        choices?: Array<{
          message?: {
            tool_calls?: Array<{
              function?: {
                name?: string;
                arguments?: string;
              };
            }>;
          };
        }>;
      };
      const toolCall = payload.choices?.[0]?.message?.tool_calls?.[0];
      const name = toolCall?.function?.name;
      if (name === "ping") {
        return true;
      }
      lastError = "No tool call returned";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError);
}

export async function probeLocalModel(config: ProbeOptions): Promise<LocalModelHealth> {
  const endpoint = normalizeBaseUrl(config.endpoint);
  const modelName = config.modelName.trim();
  const timeoutMs = Math.max(1000, config.timeoutMs ?? 5000);
  // Reasoning models (Qwen3, DeepSeek-R1, etc.) often spend tens of seconds
  // thinking before emitting a tool call. Give the tool-call probe its own,
  // generous budget so we don't falsely cache `toolCalls: false` on timeout.
  const toolCallTimeoutMs = Math.max(1000, config.toolCallTimeoutMs ?? 60_000);
  if (!LOCAL_PROVIDER_SET.has(config.provider)) {
    return buildHealthResult(config, {
      ok: false,
      message: `Unsupported local provider: ${config.provider}`,
    });
  }
  if (!endpoint || !modelName) {
    return buildHealthResult(config, {
      ok: false,
      message: "Endpoint and model name are required",
    });
  }

  try {
    let models: string[] = [];
    let modelListError = "Connection failed";
    for (const url of buildCandidateUrls(endpoint, "models")) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) {
          modelListError = `HTTP ${res.status}`;
          continue;
        }
        const data = await res.json();
        models = extractModels(data);
        if (models.length > 0) break;
        modelListError = typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : "Connected, but the server did not return a model list";
      } catch (error) {
        modelListError = error instanceof Error ? error.message : String(error);
      }
    }
    if (models.length === 0) {
      return buildHealthResult(config, {
        ok: false,
        models,
        message: modelListError,
      });
    }
    if (!models.includes(modelName)) {
      return buildHealthResult(config, {
        ok: false,
        models,
        message: `Connected, but model "${modelName}" was not found`,
      });
    }

    let streaming = false;
    let toolCalls = false;
    let streamingError = "";
    let toolError = "";

    try {
      streaming = await probeStreaming(endpoint, modelName, timeoutMs);
    } catch (error) {
      streamingError = error instanceof Error ? error.message : String(error);
    }

    try {
      toolCalls = await probeToolCalls(endpoint, modelName, toolCallTimeoutMs);
    } catch (error) {
      toolError = error instanceof Error ? error.message : String(error);
    }

    const issues: string[] = [];
    if (!streaming) issues.push(`streaming failed${streamingError ? `: ${streamingError}` : ""}`);
    if (!toolCalls) issues.push(`tool calls failed${toolError ? `: ${toolError}` : ""}`);

    return buildHealthResult(config, {
      ok: streaming && toolCalls,
      modelFound: true,
      streaming,
      toolCalls,
      models,
      message: issues.length === 0
        ? "Connected — model found, streaming works, and tool calls work"
        : `Connected, but ${issues.join("; ")}`,
    });
  } catch (error) {
    return buildHealthResult(config, {
      ok: false,
      message: error instanceof Error ? error.message : "Connection failed",
    });
  }
}

export function readCachedLocalModelHealth(): LocalModelHealth | null {
  try {
    const parsed = JSON.parse(readFileSync(HEALTH_FILE, "utf-8")) as LocalModelHealth;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCachedLocalModelHealth(health: LocalModelHealth): void {
  try {
    mkdirSync(join(homedir(), ".hive"), { recursive: true });
    writeFileSync(HEALTH_FILE, JSON.stringify(health, null, 2));
  } catch {
    // best effort
  }
  g.__hiveLocalModelHealth = health;
}

export function invalidateCachedLocalModelHealth(): void {
  g.__hiveLocalModelHealth = null;
}

export async function getLocalModelHealth(options?: { maxAgeMs?: number; timeoutMs?: number; toolCallTimeoutMs?: number }): Promise<LocalModelHealth | null> {
  const config = getLocalModelConfig();
  if (!config) return null;

  const maxAgeMs = options?.maxAgeMs ?? 5 * 60_000;
  const cached = g.__hiveLocalModelHealth ?? readCachedLocalModelHealth();
  if (cached) {
    g.__hiveLocalModelHealth = cached;
    const ageMs = Date.now() - new Date(cached.checkedAt).getTime();
    const sameConfig =
      cached.endpoint === normalizeBaseUrl(config.endpoint) &&
      cached.modelName === config.modelName &&
      cached.provider === config.provider;
    if (sameConfig && ageMs >= 0 && ageMs <= maxAgeMs) {
      return cached;
    }
  }

  if (g.__hiveLocalModelHealthPromise) {
    return g.__hiveLocalModelHealthPromise;
  }

  g.__hiveLocalModelHealthPromise = probeLocalModel({ ...config, timeoutMs: options?.timeoutMs, toolCallTimeoutMs: options?.toolCallTimeoutMs })
    .then((health) => {
      writeCachedLocalModelHealth(health);
      return health;
    })
    .finally(() => {
      g.__hiveLocalModelHealthPromise = null;
    });

  return g.__hiveLocalModelHealthPromise;
}

export function getLocalFallbackSettings(): LocalFallbackSettings {
  try {
    const config = JSON.parse(readFileSync(join(homedir(), ".hive", "config.json"), "utf-8")) as {
      localFallback?: Partial<LocalFallbackSettings>;
    };
    return {
      enabled: config.localFallback?.enabled ?? DEFAULT_LOCAL_FALLBACK.enabled,
      offlineEnabled: config.localFallback?.offlineEnabled ?? DEFAULT_LOCAL_FALLBACK.offlineEnabled,
    };
  } catch {
    return { ...DEFAULT_LOCAL_FALLBACK };
  }
}
