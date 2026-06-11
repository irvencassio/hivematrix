// Codex agent stub — Hive 1 Codex path kept for compatibility; not active in HiveMatrix v1.
import type { AgentProcess, AgentEventHandler } from "./subprocess";

export function spawnCodexAgent(
  taskId: string,
  _description: string,
  projectPath: string,
  _maxBudgetUsd: number,
  _onEvent: AgentEventHandler,
  _onExit: (taskId: string, code: number | null, signal: string | null) => void,
  _model: string,
  _resumeSessionId?: string | null,
  _thinkingMode?: string,
): AgentProcess {
  throw new Error(`[codex-agent] Codex model not supported in HiveMatrix v1 (taskId=${taskId}, projectPath=${projectPath})`);
}
