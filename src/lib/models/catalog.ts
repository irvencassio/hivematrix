// HiveMatrix model catalog.
// Direct Google/Gemini provider removed. Nano Banana uses the "nanai" abstract image provider;
// the underlying model ID is kept here as the canonical string (allowed by scope-wall).
// mflux local fallback for image role is configured via router policy, not here.
export type ModelOption =
  | "opus"
  | "sonnet"
  | "haiku"
  | "nano-banana"
  | "chatgpt"
  | "codex-computer-use"
  | "local";

export interface ModelDef {
  value: ModelOption;
  label: string;
  description: string;
  modelId: string | null;
  provider?: string;
}

export const CODEX_MODEL_PREFIX = "codex:";

export const MODEL_OPTIONS: ModelDef[] = [
  { value: "opus", label: "Opus", description: "Claude subscription, highest quality", modelId: "claude-opus-4-8" },
  { value: "sonnet", label: "Sonnet", description: "Claude subscription, fast and capable", modelId: "claude-sonnet-4-6" },
  { value: "haiku", label: "Haiku", description: "Claude subscription, lightweight tasks", modelId: "claude-haiku-4-5-20251001" },
  { value: "chatgpt", label: "ChatGPT", description: "OpenAI subscription via Codex CLI", modelId: "codex:gpt-5.4", provider: "codex" },
  { value: "codex-computer-use", label: "Codex Computer Use", description: "Codex driving your screen — mouse, keyboard, screenshots", modelId: "codex:gpt-5.4-computer-use", provider: "codex" },
  { value: "nano-banana", label: "Nano Banana", description: "Image generation (cloud-ok); local mflux fallback in local-only/offline", modelId: "gemini-3.1-flash-image-preview", provider: "nanai" },
  { value: "local", label: "Local Model", description: "MLX / llama.cpp / Ollama — Qwen3 profile", modelId: null },
];

export const MODEL_SHORT_NAMES: Record<string, string> = {
  "claude-opus-4-8": "Opus",
  "claude-sonnet-4-6": "Sonnet",
  "claude-haiku-4-5-20251001": "Haiku",
  "gemini-3.1-flash-image-preview": "Nano Banana",
  "codex:gpt-5.4": "ChatGPT",
  "codex:gpt-5.4-computer-use": "Codex CU",
};

export const CODEX_COMPUTER_USE_MODEL_ID = "codex:gpt-5.4-computer-use";
export const NANO_BANANA_MODEL_ID = "gemini-3.1-flash-image-preview";

export function isCodexComputerUseModel(modelId?: string | null): boolean {
  return modelId === CODEX_COMPUTER_USE_MODEL_ID;
}

export function isCodexModel(modelId?: string | null): boolean {
  return Boolean(modelId?.startsWith(CODEX_MODEL_PREFIX));
}

export function isNanoBananaModel(modelId?: string | null): boolean {
  return modelId === NANO_BANANA_MODEL_ID;
}

export function resolveCodexModel(modelId: string): string {
  return modelId.slice(CODEX_MODEL_PREFIX.length) || "gpt-5.4";
}

export function normalizeModelOption(value: unknown): ModelOption {
  if (value === "openai" || value === "openai-api") return "chatgpt";
  if (typeof value === "string" && MODEL_OPTIONS.some((m) => m.value === value)) {
    return value as ModelOption;
  }
  return "sonnet";
}

export function isImageGenerationModelOption(value: ModelOption | null | undefined): boolean {
  return value === "nano-banana";
}
