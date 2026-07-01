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
  // Claude models use the CLI's version-agnostic aliases ("opus"/"sonnet"/"haiku"),
  // so selection always resolves to the latest model for that tier.
  { value: "opus", label: "Opus", description: "Claude subscription, highest quality", modelId: "opus" },
  { value: "sonnet", label: "Sonnet", description: "Claude subscription, fast and capable", modelId: "sonnet" },
  { value: "haiku", label: "Haiku", description: "Claude subscription, lightweight tasks", modelId: "haiku" },
  { value: "chatgpt", label: "ChatGPT", description: "OpenAI subscription via Codex CLI", modelId: "codex:gpt-5.4", provider: "codex" },
  { value: "codex-computer-use", label: "Codex Computer Use", description: "Codex driving your screen — mouse, keyboard, screenshots", modelId: "codex:gpt-5.4-computer-use", provider: "codex" },
  { value: "nano-banana", label: "Nano Banana", description: "Image generation (cloud-ok); local mflux fallback in local-only/offline", modelId: "gemini-3.1-flash-image-preview", provider: "nanai" },
  { value: "local", label: "Local Model", description: "MLX / llama.cpp / Ollama — Qwen3 profile", modelId: null },
];

export const MODEL_SHORT_NAMES: Record<string, string> = {
  "claude-opus-4-8": "Opus",
  "claude-sonnet-4-6": "Sonnet",
  "claude-haiku-4-5-20251001": "Haiku",
  "codex:gpt-5.5": "Codex 5.5",
  "codex:gpt-5.3-codex-spark": "Spark",
  "gemini-3.1-flash-image-preview": "Nano Banana",
  "codex:gpt-5.4": "ChatGPT",
  "codex:gpt-5.4-computer-use": "Codex CU",
};

/**
 * Short display name for a Claude model by FAMILY, robust to version changes.
 * Matches the bare CLI alias (what tasks now carry) and any resolved full id the
 * CLI reports back in its stream (e.g. `claude-sonnet-5-0` → "Sonnet"). Returns
 * null for non-Claude models so callers can fall through to other lookups.
 */
export function claudeShortName(modelId: string): "Opus" | "Sonnet" | "Haiku" | null {
  const m = (modelId || "").toLowerCase().trim();
  if (m === "opus" || m.startsWith("claude-opus")) return "Opus";
  if (m === "sonnet" || m.startsWith("claude-sonnet")) return "Sonnet";
  if (m === "haiku" || m.startsWith("claude-haiku")) return "Haiku";
  return null;
}

/**
 * Canonical selection id for a Claude model: a legacy pinned full id
 * (`claude-opus-4-8`) or a resolved id (`claude-sonnet-5-0`) collapses to the
 * bare CLI alias (`opus`/`sonnet`/`haiku`) the catalog now offers. Non-Claude
 * ids (local, `codex:*`) and already-alias values pass through unchanged, so
 * this is safe to map over any stored model id for display.
 */
export function claudeAliasId(modelId: string): string {
  const short = claudeShortName(modelId);
  return short ? (short.toLowerCase() as "opus" | "sonnet" | "haiku") : modelId;
}

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
