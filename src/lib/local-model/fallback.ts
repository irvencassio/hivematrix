import { resolveProject } from "@/lib/routing/aliases";
import { CODEX_COMPUTER_USE_MODEL_ID, isCodexModel } from "@/lib/models/catalog";
import { detectProvider } from "@/lib/config/providers";
import { getLocalModelConfig } from "@/lib/config/constants";
import { getLocalFallbackSettings, getLocalModelHealth } from "./health";
import { normalizeRetryProjectForModel } from "@/lib/models/task-model";

export type LocalFallbackReason = "usage" | "offline" | "provider_unavailable";

export interface LocalFallbackDecision {
  modelId: string;
  project: string;
  projectPath: string;
  reason: LocalFallbackReason;
  summary: string;
}

function isLocalProvider(provider: string | null): boolean {
  return provider === "ollama" || provider === "lmstudio" || provider === "mlx" || provider === "vllm" || provider === "nanai";
}

export function isEligibleForLocalFallback(modelId: string | null | undefined): boolean {
  if (modelId === CODEX_COMPUTER_USE_MODEL_ID) return false;
  if (!modelId) return true;
  if (modelId.startsWith("claude-")) return true;
  if (isCodexModel(modelId)) return true;
  return !isLocalProvider(detectProvider(modelId));
}

export async function getLocalFallbackDecision(args: {
  currentModelId: string | null | undefined;
  project: string;
  reason: LocalFallbackReason;
}): Promise<LocalFallbackDecision | null> {
  if (!isEligibleForLocalFallback(args.currentModelId)) return null;

  const config = getLocalModelConfig();
  if (!config?.modelName) return null;

  const settings = getLocalFallbackSettings();
  if (!settings.enabled) return null;
  if (args.reason !== "usage" && !settings.offlineEnabled) return null;

  const health = await getLocalModelHealth({ maxAgeMs: 5 * 60_000, timeoutMs: 4000, toolCallTimeoutMs: 4000 });
  if (!health?.ready) return null;
  if (args.reason !== "usage" && !health.offlineReady) return null;

  const project = normalizeRetryProjectForModel(args.project, args.currentModelId, config.modelName);
  const projectPath = resolveProject(project);
  if (!projectPath) return null;

  const summary = args.reason === "usage"
    ? `Usage exhausted — switching to local model ${config.modelName}.`
    : `Cloud model unavailable — switching to local model ${config.modelName}.`;

  return {
    modelId: config.modelName,
    project,
    projectPath,
    reason: args.reason,
    summary,
  };
}
