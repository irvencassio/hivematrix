import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const MAX_AGENTS = 4;
export const DEFAULT_TIMEOUT_MINUTES = 60;
export const DEFAULT_BUDGET_USD = 0;
export const MAX_TURNS = 50;
export const SCHEDULER_INTERVAL_MS = 2000;
export const APPROVAL_TIMEOUT_MINUTES = 30;
export const WS_LOG_THROTTLE_MS = 200; // max 5 updates/sec per task
export const MAX_LOGS_PER_TASK = 10000;
export const ARTIFACT_RETENTION_DAYS = 30;
export const ARTIFACT_RETENTION_INTERVAL_MS = 60 * 60 * 1000; // hourly

export const ALLOWED_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "Agent",
  "Edit",
  "Write",
  "Skill",
  "TodoWrite",
  "Bash",
  "ToolSearch",
  "AskUserQuestion",
];

// Ops tasks get broader tool access — Bash unrestricted for running scripts/pipelines
const OPS_BASE_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "Agent",
  "Edit",
  "Write",
  "Skill",
  "TodoWrite",
  "Bash",
  "ToolSearch",
  "AskUserQuestion",
];

// SSH MCP tools — only included when sshDiagnostics is enabled in settings
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
    ? [...OPS_BASE_TOOLS, ...SSH_TOOLS]
    : OPS_BASE_TOOLS;
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
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

// Active profile — stored globally, switchable from the dashboard
const g = globalThis as unknown as { __hiveActiveProfile?: string };

export function getActiveProfile(): string {
  if (g.__hiveActiveProfile) return g.__hiveActiveProfile;
  try {
    const config = JSON.parse(readFileSync(join(homedir(), ".hive", "config.json"), "utf-8"));
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
    const config = JSON.parse(readFileSync(join(homedir(), ".hive", "config.json"), "utf-8"));
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
    const config = JSON.parse(readFileSync(join(homedir(), ".hive", "config.json"), "utf-8"));
    if (config.localModel?.endpoint && config.localModel?.modelName) {
      return config.localModel;
    }
    return null;
  } catch {
    return null;
  }
}
