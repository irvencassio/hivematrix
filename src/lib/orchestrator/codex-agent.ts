/**
 * Codex harness — drives the `codex exec` CLI headlessly and adapts its output
 * to the AgentProcess/event model used by the rest of the orchestrator.
 *
 * Codex models are addressed as `codex:<model>` (e.g. codex:gpt-5.5-codex);
 * fastMode lowers the reasoning effort for a quicker, cheaper pass.
 */

import { spawn } from "child_process";
import type { AgentProcess, AgentEventHandler } from "./subprocess";
import { findBinary, CODEX_BINARY_SEARCH_PATHS, buildCliPath } from "@/lib/config/binary-detection";
import { resolveCodexModel } from "@/lib/models/catalog";

let fakePidCounter = -5000;

export function spawnCodexAgent(
  taskId: string,
  description: string,
  projectPath: string,
  _maxBudgetUsd: number,
  onEvent: AgentEventHandler,
  onExit: (taskId: string, code: number | null, signal: string | null) => void,
  model: string,
  _resumeSessionId?: string | null,
  _thinkingMode?: string,
  fastMode?: boolean,
): AgentProcess {
  const codexPath = findBinary("codex", CODEX_BINARY_SEARCH_PATHS);
  if (!codexPath) {
    throw new Error("[codex-agent] codex CLI not found — install Codex and run `codex login`.");
  }
  const codexModel = resolveCodexModel(model); // strips the "codex:" prefix

  const args = [
    "exec",
    "--skip-git-repo-check",
    "-s", "workspace-write",        // may edit files in the working dir
    "-m", codexModel,
    "-C", projectPath,
  ];
  if (fastMode) {
    args.push("-c", 'model_reasoning_effort="low"');
  }
  args.push(description);

  const proc = spawn(codexPath, args, {
    cwd: projectPath,
    env: { ...process.env, PATH: buildCliPath() },
    // The prompt is passed as a positional arg, so codex needs no stdin.
    // Leaving stdin as an open pipe makes `codex exec` block forever on
    // "Reading additional input from stdin..." — close it so it proceeds.
    stdio: ["ignore", "pipe", "pipe"],
  });

  const pid = proc.pid ?? fakePidCounter--;
  const agent: AgentProcess = {
    proc,
    pid,
    taskId,
    projectPath,
    startedAt: new Date(),
    textBuffer: "",
    modelsUsed: [model],
    launchCommand: `${codexPath} exec -m ${codexModel}${fastMode ? " (fast)" : ""}`,
  };

  onEvent(taskId, { type: "init", model });

  proc.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8");
    agent.textBuffer += text;
    onEvent(taskId, { type: "text", content: text });
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    onEvent(taskId, { type: "error", content: chunk.toString("utf-8").slice(0, 500) });
  });

  proc.on("error", (err) => {
    onEvent(taskId, { type: "error", content: `codex spawn error: ${err.message}` });
    onExit(taskId, 1, null);
  });

  proc.on("close", (code, signal) => {
    const result = agent.textBuffer.slice(-2000);
    agent.lastResult = {
      cost: 0, result, sessionId: taskId, turns: 1,
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, contextWindow: 0,
    };
    onEvent(taskId, {
      type: "result", sessionId: taskId, cost: 0, result, turns: 1,
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, contextWindow: 0,
    });
    onExit(taskId, code ?? 0, signal ?? null);
  });

  return agent;
}
