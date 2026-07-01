import type { HiveTask } from "@/lib/types";
import { MODEL_SHORT_NAMES, claudeShortName } from "./catalog";

type TaskModelSource = Pick<HiveTask, "model" | "output">;

export function getEffectiveTaskModelId(task: TaskModelSource): string | null {
  const outputModel = task.output?.modelsUsed?.[task.output.modelsUsed.length - 1];
  if (typeof outputModel === "string" && outputModel.trim()) return outputModel.trim();

  const savedModel = task.model?.trim();
  return savedModel ? savedModel : null;
}

export function getTaskModelShortName(modelId: string, localModelName: string): string {
  if (localModelName && modelId === localModelName) return "Local";
  const claude = claudeShortName(modelId);
  if (claude) return claude;
  if (MODEL_SHORT_NAMES[modelId]) return MODEL_SHORT_NAMES[modelId];
  if (modelId.includes("nemotron")) return "Nemotron";

  const parts = modelId.split(/[/-]/).filter(Boolean);
  return parts[parts.length - 1] ?? modelId;
}
