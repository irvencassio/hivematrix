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

export function claudeEffortMode(value: unknown): Exclude<ThinkingMode, "auto" | "ultrathink"> {
  const mode = resolveThinkingMode(value);
  if (mode === "auto" || mode === "ultrathink") return DEFAULT_THINKING_MODE;
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

/**
 * Map a thinking mode to the DeepSeek/DwarfStar `reasoning_effort` request field.
 * The dwarfstar server defaults every chat request to high-effort thinking, which
 * dominates local-turn latency (hundreds–thousands of <think> tokens at ~28 t/s).
 * Sending an explicit effort makes the per-task thinking mode actually reach the
 * model so lighter tasks decode faster. "max" needs a very large context and
 * otherwise degrades to high server-side. "off" is not a reasoning_effort value —
 * it is expressed via the thinking off-switch (see `dwarfstarThinkingFields`).
 */
export function dwarfstarReasoningEffort(value: unknown): "off" | "low" | "medium" | "high" | "max" {
  const mode = resolveThinkingMode(value);
  if (mode === "off") return "off";
  if (mode === "low" || mode === "medium" || mode === "high") return mode;
  if (mode === "xhigh") return "high";
  return "max"; // "max" / "ultrathink" / default
}

const EXPLICIT_HEAVY_TIERS = new Set(["medium", "high", "xhigh", "max", "ultrathink"]);

/**
 * Per-turn thinking mode for a DwarfStar agent loop — "think at the ends, skip
 * in the mechanical middle".
 *
 * DeepSeek's biggest latency lever is skipping <think> (a 35B tool turn measured
 * 15.5s → 0.76s with reasoning off). Within an agent loop the reasoning that
 * earns its cost happens at the boundaries: the first turn (planning the
 * approach) and the final synthesis turn (writing the answer). The turns in
 * between just react to a tool result and dispatch the next call — mechanical
 * work that rarely needs deep reasoning. So on those tool-continuation turns we
 * send the "off" switch.
 *
 * Operator override: when the task explicitly asks for a heavy tier
 * (medium+/high/xhigh/max/ultrathink — a deliberate "think hard" choice, not the
 * unset/auto default), reasoning stays on for every turn. Light/default tasks
 * (unset, "auto", "off", "low") take the adaptive path.
 *
 * `rawTaskMode` must be the *raw* task value, not a resolved one — "auto" and
 * unset both resolve to "max", so only the raw string distinguishes a deliberate
 * "max" from the default.
 */
export function autoTurnThinkingMode(
  rawTaskMode: string | null | undefined,
  turn: { continuationAfterTool: boolean },
): ThinkingMode {
  const raw = typeof rawTaskMode === "string" ? rawTaskMode.trim() : "";
  // Operator deliberately chose to think hard → honor it on every turn.
  if (EXPLICIT_HEAVY_TIERS.has(raw)) return resolveThinkingMode(raw);
  // Light / default task: skip <think> on mechanical tool-continuation turns.
  if (turn.continuationAfterTool) return "off";
  // Planning / synthesis boundary: keep the task's resolved tier.
  return resolveThinkingMode(raw);
}

/**
 * The DwarfStar request fields that carry the task's thinking directive.
 *
 * For a real thinking tier this is `{ reasoning_effort }`. For "off" it is the
 * server's per-request thinking off-switch — `thinking:{type:"disabled"}` plus
 * the shorthand `think:false` — which skips <think> generation entirely. That is
 * ds4's single biggest latency lever and, unlike the engine-level `--no-thinking`
 * flag, it can be chosen per request (e.g. for mechanical / tool-only turns)
 * without restarting the server or affecting other tasks sharing it.
 */
export function dwarfstarThinkingFields(value: unknown): Record<string, unknown> {
  const effort = dwarfstarReasoningEffort(value);
  if (effort === "off") return { thinking: { type: "disabled" }, think: false };
  return { reasoning_effort: effort };
}
