export const UNCAPPED_BUDGET_USD = 0;
export const DEFAULT_BUDGET_USD = UNCAPPED_BUDGET_USD;
export const DEFAULT_THINKING_MODE = "max";

export type ThinkingMode =
  | "auto"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultrathink";

const THINKING_MODES = new Set<ThinkingMode>([
  "auto",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultrathink",
]);

export function normalizeBudgetUsd(value: unknown): number {
  if (value === null || value === undefined || value === "") return UNCAPPED_BUDGET_USD;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : UNCAPPED_BUDGET_USD;
}

export function hasBudgetCeiling(value: unknown): boolean {
  return normalizeBudgetUsd(value) > UNCAPPED_BUDGET_USD;
}

export function resolveThinkingMode(value: unknown): ThinkingMode {
  const mode = typeof value === "string" ? value.trim() : "";
  if (!mode || mode === "auto") return DEFAULT_THINKING_MODE;
  return THINKING_MODES.has(mode as ThinkingMode) ? mode as ThinkingMode : DEFAULT_THINKING_MODE;
}

export function claudeEffortMode(value: unknown): Exclude<ThinkingMode, "auto" | "ultrathink"> {
  const mode = resolveThinkingMode(value);
  if (mode === "auto" || mode === "ultrathink") return DEFAULT_THINKING_MODE;
  return mode;
}

export function codexReasoningEffort(value: unknown): "low" | "medium" | "high" | "xhigh" {
  const mode = resolveThinkingMode(value);
  if (mode === "low" || mode === "medium" || mode === "high") return mode;
  return "xhigh";
}

/**
 * Map a thinking mode to the DeepSeek/DwarfStar `reasoning_effort` request field.
 * The dwarfstar server defaults every chat request to high-effort thinking, which
 * dominates local-turn latency (hundreds–thousands of <think> tokens at ~28 t/s).
 * Sending an explicit effort makes the per-task thinking mode actually reach the
 * model so lighter tasks decode faster. "max" needs a very large context and
 * otherwise degrades to high server-side.
 */
export function dwarfstarReasoningEffort(value: unknown): "low" | "medium" | "high" | "max" {
  const mode = resolveThinkingMode(value);
  if (mode === "low" || mode === "medium" || mode === "high") return mode;
  if (mode === "xhigh") return "high";
  return "max"; // "max" / "ultrathink" / default
}
