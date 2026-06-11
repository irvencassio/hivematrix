// Image agent stub — nano-banana / mflux image generation; Phase 2 implementation.
import type { AgentProcess, AgentEventHandler } from "./subprocess";

export function spawnImageAgent(
  taskId: string,
  _description: string,
  projectPath: string,
  _onEvent: AgentEventHandler,
  _onExit: (taskId: string, code: number | null, signal: string | null) => void,
  _provider: unknown,
  _model: string,
): AgentProcess {
  throw new Error(`[image-agent] Image generation not supported in HiveMatrix v1 (taskId=${taskId}, projectPath=${projectPath})`);
}
