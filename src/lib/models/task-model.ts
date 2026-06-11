import { MODEL_OPTIONS, type ModelOption } from "./catalog";
import { normalizeTaskProjectForModel } from "./computer-use";

export function resolveTaskModelId(
  option: ModelOption | null | undefined,
  localModelName: string,
): string | undefined {
  if (!option) return undefined;
  if (option === "local") return localModelName || undefined;
  return MODEL_OPTIONS.find((model) => model.value === option)?.modelId ?? undefined;
}

export function resolveTaskModelOption(
  modelId: string | null | undefined,
  localModelName: string,
): ModelOption | null {
  if (!modelId) return null;
  if (localModelName && modelId === localModelName) return "local";
  return MODEL_OPTIONS.find((model) => model.modelId === modelId)?.value ?? null;
}

export function normalizeRetryProjectForModel(
  project: string,
  existingModelId: string | null | undefined,
  nextModelId: string | null | undefined,
): string {
  return normalizeTaskProjectForModel(project, nextModelId ?? existingModelId);
}
