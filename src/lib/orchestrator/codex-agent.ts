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
import { readLatestCodexTokenUsage } from "@/lib/usage/codex";
import { outboundHttpRoutingPrompt, brainSearchRoutingPrompt, beeToolsRoutingPrompt } from "./outbound-routing";

let fakePidCounter = -5000;

/**
 * Codex `exec` has no `--append-system-prompt`, so the outbound-channel routing
 * guidance is prepended to the prompt (clearly delimited) — same end as the
 * Claude Code bridge: send email/SMS through the daemon's trust-gated endpoints
 * with the shell, not osascript.
 */
export function buildCodexPrompt(description: string): string {
  return `${outboundHttpRoutingPrompt()}\n\n${brainSearchRoutingPrompt()}\n\n${beeToolsRoutingPrompt()}\n\n--- Your task ---\n${description}`;
}

/**
 * Build the `codex` argv (everything after the binary). The prompt is placed
 * after a `--` end-of-options separator: it starts with the routing guide
 * ("--- Outbound Channels …"), and without `--` a clap-style parser rejects it
 * as an unknown flag ("unexpected argument '--- …'") and the task fails.
 */
export function buildCodexExecArgs(opts: {
  codexModel: string;
  projectPath: string;
  fastMode?: boolean;
  prompt: string;
}): string[] {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "-s", "workspace-write",
    "-m", opts.codexModel,
    "-C", opts.projectPath,
  ];
  if (opts.fastMode) {
    args.push("-c", 'model_reasoning_effort="low"');
  }
  args.push("--", opts.prompt);
  return args;
}

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

  const args = buildCodexExecArgs({
    codexModel,
    projectPath,
    fastMode,
    prompt: buildCodexPrompt(description),
  });

  const proc = spawn(codexPath, args, {
    cwd: projectPath,
    env: { ...process.env, PATH: buildCliPath(), HIVE_DAEMON_PORT: process.env.HIVEMATRIX_PORT ?? "3747" },
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
    if (!agent.firstTokenAt && text) agent.firstTokenAt = new Date();
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
    // Recover token usage from Codex's own session log (stdout has none).
    let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, reasoningTokens = 0;
    try {
      const usage = readLatestCodexTokenUsage(agent.startedAt.getTime());
      if (usage) {
        inputTokens = usage.inputTokens;
        outputTokens = usage.outputTokens;
        cacheReadTokens = usage.cachedInputTokens;
        reasoningTokens = usage.reasoningTokens;
      }
    } catch { /* best-effort — leave as 0 (= unavailable downstream) */ }
    agent.lastResult = {
      cost: 0, result, sessionId: taskId, turns: 1,
      inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens: 0, contextWindow: 0, reasoningTokens,
    };
    onEvent(taskId, {
      type: "result", sessionId: taskId, cost: 0, result, turns: 1,
      inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens: 0, contextWindow: 0,
    });
    onExit(taskId, code ?? 0, signal ?? null);
  });

  return agent;
}
