export const UNCAPPED_BUDGET_USD = 0;
export const DEFAULT_BUDGET_USD = UNCAPPED_BUDGET_USD;
export const DEFAULT_THINKING_MODE = "max";

export type ThinkingMode =
  | "auto"
  | "off"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultrathink";

const THINKING_MODES = new Set<ThinkingMode>([
  "auto",
  "off",
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

/**
 * Resolve the `--effort` value for the Claude Code CLI.
 *
 * "auto" (and unset) returns "auto", which is NOT a level the CLI accepts — the
 * caller omits the flag entirely for it (see EFFORT_LEVELS in subprocess.ts), so
 * Claude Code picks its own effort per turn exactly as it does in a direct
 * interactive session. That adaptive behavior is the point: previously "auto"
 * collapsed to "max", so every task — including trivial ones — paid maximum
 * reasoning latency, which is the single biggest reason Hive-run generation felt
 * slower than running `claude` directly.
 *
 * An explicit tier (low/medium/high/xhigh/max) is always honored, and an
 * unrecognized value still falls back to the conservative default rather than
 * silently going adaptive.
 */
export function claudeEffortMode(value: unknown): Exclude<ThinkingMode, "ultrathink"> {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw === "auto") return "auto";
  const mode = resolveThinkingMode(raw);
  if (mode === "ultrathink") return DEFAULT_THINKING_MODE;
  // Claude Code cannot disable thinking; "off" degrades to its lightest tier.
  if (mode === "off") return "low";
  return mode;
}

export function codexReasoningEffort(value: unknown): "low" | "medium" | "high" | "xhigh" {
  const mode = resolveThinkingMode(value);
  // Codex has no "off"; the lightest reasoning tier is the closest equivalent.
  if (mode === "off") return "low";
  if (mode === "low" || mode === "medium" || mode === "high") return mode;
  return "xhigh";
}
