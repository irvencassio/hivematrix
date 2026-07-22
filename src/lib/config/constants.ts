import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const MAX_AGENTS = 4;
export const DEFAULT_TIMEOUT_MINUTES = 60;
// Unattended-runaway backstop: since native-task-execution removed the CLI
// turn cap (tasks now run to completion like a direct interactive session),
// every task needs a real default cost ceiling rather than an unbounded one.
// 0 remains the explicit "uncapped" opt-out (see budget-policy.ts) — this is
// only the default applied when a task doesn't set its own budget.
//
// Uncapped by default (0 → normalizeBudgetUsd treats it as no ceiling, so no
// --max-budget-usd flag is passed), matching Claude Code itself: the CLI and web
// impose no per-task dollar cap and run until the work is done or the account's
// usage windows (5h/7d) are hit. A dollar ceiling on usage-window billing is
// artificial and historically killed near-complete tasks (a $10 cap killed three
// at $10.35–$10.68, ~95% done). Runaways are still bounded by the real limiters:
// the per-task wall-clock timeout (timeoutMinutes, default 60) and the
// scheduler's usage_limit delay. A user who wants a hard ceiling can still set an
// explicit positive maxBudgetUsd per task; only the DEFAULT is uncapped.
export const DEFAULT_BUDGET_USD = 0;
export const MAX_TURNS = 50;
export const SCHEDULER_INTERVAL_MS = 2000;
export const APPROVAL_TIMEOUT_MINUTES = 30;
export const WS_LOG_THROTTLE_MS = 200; // max 5 updates/sec per task
export const MAX_LOGS_PER_TASK = 10000;
export const ARTIFACT_RETENTION_DAYS = 30;
export const ARTIFACT_RETENTION_INTERVAL_MS = 60 * 60 * 1000; // hourly

/**
 * Core coding tool names for OpenAI-compatible agents (Qwen/generic).
 * Canonical source of truth; the Claude list below covers the same capabilities.
 */
export const CODING_OPENAI_TOOLS = [
  "bash",       // Bash
  "read_file",  // Read
  "write_file", // Write
  "edit_file",  // Edit
  "search",     // Grep
  "list_files", // Glob
] as const;
export type CodingOpenAITool = typeof CODING_OPENAI_TOOLS[number];

// Claude Code tool names for the same core capabilities + orchestration extras.
// When adding/removing a core capability, update CODING_OPENAI_TOOLS above too.
const CODING_BASE_TOOLS = [
  "Read",    // read_file
  "Glob",    // list_files
  "Grep",    // search
  "Edit",    // edit_file
  "Write",   // write_file
  "Bash",    // bash
  // Orchestration: Claude Code only, no OpenAI-compat equivalent
  "Agent",
  "Skill",
  "TodoWrite",
  "ToolSearch",
  "AskUserQuestion",
];

export const ALLOWED_TOOLS = CODING_BASE_TOOLS;

// SSH MCP tools: only included when sshDiagnostics is enabled in settings.
export const SSH_TOOLS = [
  "mcp__ssh__list_hosts",
  "mcp__ssh__exec",
  "mcp__ssh__read_file",
  "mcp__ssh__compare_files",
  "mcp__ssh__list_crontabs",
  "mcp__ssh__check_cron_output",
  "mcp__ssh__propose_fix",
];

export function getOpsAllowedTools(): string[] {
  return isSshDiagnosticsEnabled()
    ? [...CODING_BASE_TOOLS, ...SSH_TOOLS]
    : CODING_BASE_TOOLS;
}

export const RISKY_TOOL_PATTERNS: Record<string, RegExp[]> = {
  Bash: [
    /git reset/,
    /rm -rf/,
    /npm publish/,
    /docker/,
    /curl\s+-X\s+(POST|PUT|DELETE|PATCH)/,
  ],
};

export const TASK_STATUSES = [
  "ideation",
  "backlog",
  "assigned",
  "in_progress",
  "review",
  "done",
  "failed",
  "cancelled",
  "archived",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const RESULT_STATUSES = [
  "answered",
  "needs_confirmation",
  "needs_selection",
  "needs_input",
  "refused",
  "failed",
] as const;

export type ResultStatus = (typeof RESULT_STATUSES)[number];

// Active profile: stored globally, switchable from the dashboard.
const g = globalThis as unknown as { __hiveActiveProfile?: string };

/**
 * Claude CLI config dirs the operator has actually configured (config.json's
 * `profiles` array). Empty by default — the multi-account feature was
 * transplanted from Hive 1 and never wired up: this array is read in a few
 * places and written nowhere, so on every real install it is empty.
 *
 * That emptiness is the signal to leave CLAUDE_CONFIG_DIR unset entirely and
 * let the CLI use its own default credential — the same one Chat, the terminal
 * and the browser all use. See resolveClaudeConfigDir in orchestrator/subprocess.ts.
 */
export function configuredClaudeProfiles(): string[] {
  try {
    const config = JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
    const profiles: { configDir?: string }[] = Array.isArray(config.profiles) ? config.profiles : [];
    return profiles.map((p) => p?.configDir).filter((d): d is string => typeof d === "string" && d.length > 0);
  } catch {
    return [];
  }
}

export function getActiveProfile(): string {
  if (g.__hiveActiveProfile) return g.__hiveActiveProfile;
  try {
    const config = JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
    const profiles: { configDir: string }[] = config.profiles ?? [];
    const preferred = config.defaultProfile;
    if (preferred && profiles.some((p) => p.configDir === preferred)) return preferred;
    const first = profiles[0]?.configDir;
    if (first) return first;
  } catch { /* no config */ }
  return ".claude";
}

export function setActiveProfile(configDir: string) {
  g.__hiveActiveProfile = configDir;
}

export function getActiveProfileName(): string {
  return getActiveProfile().replace(/^\.claude-?/, "") || "default";
}

export function normalizeTaskProfileKey(profileOrConfigDir: string | null | undefined): string {
  const trimmed = String(profileOrConfigDir ?? "").trim();
  if (!trimmed) return "claude";
  return trimmed.replace(/^\./, "");
}

export function getActiveTaskProfileKey(): string {
  return normalizeTaskProfileKey(getActiveProfile());
}

// SSH diagnostics — opt-in feature, default off
export function isSshDiagnosticsEnabled(): boolean {
  try {
    const config = JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
    return config.sshDiagnostics === true;
  } catch {
    return false;
  }
}

// Local model configuration (LM Studio / Ollama / MLX / vLLM / Nan AI)
export interface LocalModelConfig {
  provider: "lmstudio" | "ollama" | "mlx" | "vllm" | "nanai";
  endpoint: string;
  modelName: string;
}

export function getLocalModelConfig(): LocalModelConfig | null {
  try {
    const config = JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
    if (config.localModel?.endpoint && config.localModel?.modelName) {
      return config.localModel;
    }
    return null;
  } catch {
    return null;
  }
}
