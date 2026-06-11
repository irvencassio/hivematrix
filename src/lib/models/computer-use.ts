import type { ModelOption } from "./catalog";
import { CODEX_COMPUTER_USE_MODEL_ID } from "./catalog";

export const CODEX_COMPUTER_USE_OPTION = "codex-computer-use";
export const CODEX_COMPUTER_USE_PROJECT = "ops";
export const CODEX_COMPUTER_USE_FALLBACK_OPTION: ModelOption = "chatgpt";

export function isCodexComputerUseOption(value: unknown): value is "codex-computer-use" {
  return value === CODEX_COMPUTER_USE_OPTION;
}

export function shouldRequireComputerUseConsent(
  model: ModelOption | null | undefined,
  acknowledgedComputerUse: boolean,
): boolean {
  return isCodexComputerUseOption(model) && !acknowledgedComputerUse;
}

export function getEffectiveModelOption(
  model: ModelOption,
  acknowledgedComputerUse: boolean,
): ModelOption {
  if (shouldRequireComputerUseConsent(model, acknowledgedComputerUse)) {
    return CODEX_COMPUTER_USE_FALLBACK_OPTION;
  }
  return model;
}

export function normalizeTaskProjectForModel(
  project: string,
  modelId: string | null | undefined,
): string {
  return modelId === CODEX_COMPUTER_USE_MODEL_ID ? CODEX_COMPUTER_USE_PROJECT : project;
}
