import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import type { ModelProvider } from "@/lib/config/providers";
import type { AgentProcess, AgentEventHandler } from "./subprocess";
import { promises as fsp } from "fs";
import { join } from "path";
import {
  parseOpenAIChunk,
  createStreamState,
  getCompletedToolCalls,
  getUsage,
  parseSSEStream,
} from "./openai-stream-adapter";
import { TOOL_DEFINITIONS, executeTool, type ToolContext, type ChatTool } from "./tool-bridge";
import { availableBeeTools } from "./bee-tools";
import { getAgentProfile } from "@/lib/config/agent-profiles";
import { buildBrainMemoryBundle } from "@/lib/brain/memory-bundle";
import { brainDocPolicyText } from "@/lib/brain/settings";
import { resolveThinkingMode } from "@/lib/config/budget-policy";

const MAX_TURNS = 50;
const LOCAL_OPENAI_COMPATIBLE_PROVIDERS = new Set(["ollama", "lmstudio", "mlx", "vllm", "nanai"]);

// Loop-guard thresholds: how many identical tool calls before intervening
const LOOP_WARN_THRESHOLD = 3;  // inject "you already have this" into tool result
const LOOP_BREAK_THRESHOLD = 5; // also inject a user-turn forcing a final answer

// Incrementing fake PID for generic agents (negative to avoid collision with real PIDs)
let fakePidCounter = -1000;

/**
 * A minimal ChildProcess-compatible wrapper for generic (non-CLI) agents.
 * Uses AbortController instead of process signals.
 */
class GenericProcess extends EventEmitter {
  pid: number;
  killed = false;
  exitCode: number | null = null;
  stdout = null;
  stderr = null;

  private controller: AbortController;

  constructor(pid: number, controller: AbortController) {
    super();
    this.pid = pid;
    this.controller = controller;
  }

  kill(): boolean {
    if (this.killed) return false;
    this.killed = true;
    this.controller.abort();
    return true;
  }
}

/**
 * Build the system prompt for a generic agent using agent profiles.
 * Profile determines the persona, whether to inject CLAUDE.md, and available tools.
 */
export function genericThinkingInstruction(thinkingMode?: string | null): string {
  const mode = resolveThinkingMode(thinkingMode);
  if (mode !== "max" && mode !== "ultrathink" && mode !== "xhigh") return "";
  return "Use your maximum supported reasoning depth for this task. Do not reduce scope to conserve tokens or budget.";
}

async function buildSystemPrompt(projectPath: string, agentType: string, thinkingMode?: string | null): Promise<string> {
  const profile = getAgentProfile(agentType);
  let prompt = `${profile.systemPrompt}\n\n--- Brain Doc Policy ---\n${brainDocPolicyText()}`;
  const thinkingInstruction = genericThinkingInstruction(thinkingMode);
  if (thinkingInstruction) {
    prompt += `\n\n--- Reasoning Effort ---\n${thinkingInstruction}`;
  }
  const projectName = projectPath.split("/").filter(Boolean).pop() ?? "";
  const memoryBundle = await buildBrainMemoryBundle({
    project: projectName,
    role: agentType,
    bee: projectName.toLowerCase() === "hive" ? "managerbee" : undefined,
  });

  // Add project directory context for profiles with tools
  if (profile.tools.length > 0) {
    prompt += `\n\nWorking directory: ${projectPath}`;
  }

  if (memoryBundle) {
    prompt += memoryBundle;
  }

  // Only inject CLAUDE.md for profiles that request it (developer, cto).
  // Async read so a project on a cloud mount can't stall the daemon.
  if (profile.loadClaudeMd) {
    try {
      const content = await Promise.race([
        fsp.readFile(join(projectPath, "CLAUDE.md"), "utf-8").then((c) => c).catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), 3_000)),
      ]);
      if (content) {
        prompt += `\n\nProject instructions (from CLAUDE.md):\n${content.slice(0, 4000)}`;
      }
    } catch {
      // skip
    }
  }

  return prompt;
}

/**
 * Get the tool definitions for a given agent profile.
 *
 * The profile's own allowlist filters the local file/shell tools, then the
 * embedded capability lanes (WebBee / BrowserBee / DesktopBee) are appended —
 * but only the lanes the current connectivity mode permits, so the model is
 * never shown a tool it cannot use.
 */
function getProfileTools(agentType: string): ChatTool[] {
  const profile = getAgentProfile(agentType);
  const local = profile.tools.length === 0
    ? []
    : TOOL_DEFINITIONS.filter((t) => profile.tools.includes(t.function.name));
  return [...local, ...availableBeeTools()];
}

/**
 * Build the OpenAI messages array for the initial request.
 */
async function buildMessages(
  description: string,
  projectPath: string,
  agentType: string,
  thinkingMode?: string | null
): Promise<Array<Record<string, unknown>>> {
  return [
    { role: "system", content: await buildSystemPrompt(projectPath, agentType, thinkingMode) },
    { role: "user", content: description },
  ];
}

/**
 * Strip Qwen3 <think>...</think> reasoning blocks from streamed text.
 * Returns the clean content and the extracted reasoning (for logging).
 * Handles partial blocks at the edge of a stream chunk correctly by
 * treating an unclosed <think> tag as "still thinking" (content empty).
 */
export function stripThinkBlocks(text: string): { content: string; reasoning: string } {
  if (!text.includes("<think>")) return { content: text, reasoning: "" };

  let content = "";
  let reasoning = "";
  let remaining = text;

  while (remaining) {
    const openIdx = remaining.indexOf("<think>");
    if (openIdx === -1) {
      content += remaining;
      break;
    }
    // text before the think block
    content += remaining.slice(0, openIdx);
    const afterOpen = remaining.slice(openIdx + 7);
    const closeIdx = afterOpen.indexOf("</think>");
    if (closeIdx === -1) {
      // Unclosed block — treat the rest as reasoning; content gets nothing
      reasoning += afterOpen;
      break;
    }
    reasoning += afterOpen.slice(0, closeIdx);
    remaining = afterOpen.slice(closeIdx + 8);
  }

  return { content: content.trimStart(), reasoning };
}

export function buildGenericRequestBody(
  provider: ModelProvider,
  modelId: string,
  messages: Array<Record<string, unknown>>,
  profileTools?: ChatTool[]
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    stream: true,
    max_tokens: provider.maxTokens,
  };

  if (provider.supportsTools && profileTools && profileTools.length > 0) {
    body.tools = profileTools;
  }

  return body;
}

export function buildChatCompletionsUrls(provider: ModelProvider): string[] {
  const base = provider.endpoint.replace(/\/$/, "");
  const urls = [`${base}/chat/completions`];
  if (LOCAL_OPENAI_COMPATIBLE_PROVIDERS.has(provider.name) && !base.endsWith("/v1")) {
    urls.push(`${base}/v1/chat/completions`);
  }
  return urls;
}

/**
 * Call the OpenAI-compatible chat completions API with streaming.
 */
async function callChatCompletions(
  provider: ModelProvider,
  modelId: string,
  messages: Array<Record<string, unknown>>,
  signal: AbortSignal,
  profileTools?: ChatTool[]
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (provider.apiKey) {
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
  }

  const body = buildGenericRequestBody(provider, modelId, messages, profileTools);
  let lastError: unknown = null;
  let lastResponse: Response | null = null;

  for (const url of buildChatCompletionsUrls(provider)) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
      if (response.ok) return response;
      lastResponse = response;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError ?? new Error("No chat completions endpoint could be reached");
}

/**
 * Run the agent loop: call API → parse response → execute tools → repeat.
 * Continues until the model produces a final text response or hits max turns.
 */
async function runAgentLoop(
  taskId: string,
  description: string,
  projectPath: string,
  provider: ModelProvider,
  modelId: string,
  maxBudgetUsd: number,
  onEvent: AgentEventHandler,
  controller: AbortController,
  agent: AgentProcess,
  agentType: string,
  toolContext?: ToolContext,
  thinkingMode?: string | null
): Promise<{ code: number; result: string; turns: number; totalTokens: number; inputTokens: number; outputTokens: number }> {
  const messages = await buildMessages(description, projectPath, agentType, thinkingMode);
  const profileTools = getProfileTools(agentType);
  let turns = 0;
  let fullText = "";
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  // Loop detection: count how many times each unique (tool, args) pair has been called.
  // Key = "<toolName>:<normalised-args>", value = call count.
  const toolCallCounts = new Map<string, number>();
  // Cache of file-read results so repeated reads return a stub instead of full content.
  const readCache = new Map<string, string>();
  // When true, next API call strips tools entirely so the model must produce text.
  let forceTextOnlyTurn = false;

  while (turns < MAX_TURNS) {
    if (controller.signal.aborted) {
      return { code: 1, result: "Aborted", turns, totalTokens, inputTokens, outputTokens };
    }

    turns++;

    // Call API with single retry on transient errors (429, 500, 502, 503)
    let response: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await callChatCompletions(provider, modelId, messages, controller.signal, forceTextOnlyTurn ? [] : profileTools);
      } catch (err) {
        if (controller.signal.aborted) return { code: 1, result: "Aborted", turns, totalTokens, inputTokens, outputTokens };
        if (attempt === 0) {
          onEvent(taskId, { type: "error", content: `API call failed, retrying... (${err instanceof Error ? err.message : String(err)})` });
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        const msg = err instanceof Error ? err.message : String(err);
        onEvent(taskId, { type: "error", content: `API call failed: ${msg}` });
        return { code: 1, result: `API error: ${msg}`, turns, totalTokens, inputTokens, outputTokens };
      }

      if (response && !response.ok && [429, 500, 502, 503].includes(response.status) && attempt === 0) {
        const retryAfter = response.headers.get("retry-after");
        const delay = retryAfter ? Math.min(parseInt(retryAfter, 10) * 1000, 30000) : 3000;
        onEvent(taskId, { type: "error", content: `API ${response.status}, retrying in ${Math.round(delay / 1000)}s...` });
        await new Promise((r) => setTimeout(r, delay));
        response = null;
        continue;
      }
      break;
    }

    if (!response || !response.ok) {
      const errorBody = response ? await response.text().catch(() => "unknown error") : "no response";
      onEvent(taskId, { type: "error", content: `API ${response?.status ?? "?"}: ${errorBody.slice(0, 500)}` });
      return { code: 1, result: `API error ${response?.status ?? "unknown"}`, turns, totalTokens, inputTokens, outputTokens };
    }

    if (!response.body) {
      onEvent(taskId, { type: "error", content: "No response body" });
      return { code: 1, result: "No response body", turns, totalTokens, inputTokens, outputTokens };
    }

    // Parse the streaming response
    const reader = response.body.getReader();
    const state = createStreamState();
    let turnText = "";
    let hasToolCalls = false;

    try {
      for await (const dataStr of parseSSEStream(reader, controller.signal)) {
        if (controller.signal.aborted) break;

        const events = parseOpenAIChunk(dataStr, state);
        for (const event of events) {
          if (event.type === "text") {
            turnText += event.content;
            agent.textBuffer += event.content;
          }
          if (event.type === "tool_use") {
            hasToolCalls = true;
          }
          onEvent(taskId, event);
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return { code: 1, result: "Aborted", turns, totalTokens, inputTokens, outputTokens };
      // Stream read error — try to continue with what we have
      onEvent(taskId, { type: "error", content: `Stream error: ${err instanceof Error ? err.message : String(err)}` });
    }

    // Strip Qwen3 <think> blocks before storing in conversation history.
    // The cleaned content goes into messages; reasoning is logged separately.
    const { content: cleanTurnText, reasoning: turnReasoning } = stripThinkBlocks(turnText);
    if (turnReasoning) {
      onEvent(taskId, { type: "reasoning", content: turnReasoning });
    }

    fullText += cleanTurnText;
    const usage = getUsage(state);
    totalTokens += usage.totalTokens;
    inputTokens += usage.promptTokens;
    outputTokens += usage.completionTokens;

    // Get completed tool calls from this turn
    const toolCalls = getCompletedToolCalls(state);

    if (toolCalls.length > 0 && hasToolCalls) {
      // Add assistant message with tool calls to conversation
      messages.push({
        role: "assistant",
        content: cleanTurnText || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      let loopBreakTriggered = false;

      // Execute each tool call and add results
      for (const tc of toolCalls) {
        // Normalise args to a stable key for loop detection
        let normArgs = tc.arguments;
        try {
          normArgs = JSON.stringify(JSON.parse(tc.arguments));
        } catch { /* leave raw */ }
        const loopKey = `${tc.name}:${normArgs}`;
        const callCount = (toolCallCounts.get(loopKey) ?? 0) + 1;
        toolCallCounts.set(loopKey, callCount);

        let result: string;

        if (callCount >= LOOP_BREAK_THRESHOLD) {
          // Hard stop: replace result and force a final-answer turn
          result = `[Loop guard] This tool call (${tc.name}) has been made ${callCount} times with identical arguments. Execution blocked. You must stop calling tools and write your final response now.`;
          loopBreakTriggered = true;
        } else if (callCount >= LOOP_WARN_THRESHOLD) {
          // Soft warn: return cached/stub result with a note
          const cached = readCache.get(loopKey);
          result = cached
            ? `[Already retrieved — content unchanged]\n\n${cached.slice(0, 200)}…\n\n[Loop guard: ${callCount} identical calls. Do not call this tool again. Synthesise and respond.]`
            : `[Loop guard: you have called ${tc.name} with these exact arguments ${callCount} times. Do not repeat it. Use what you already know and write your response.]`;
        } else {
          // Normal execution (async — bash runs off the event loop)
          result = await executeTool(tc.name, tc.arguments, projectPath, toolContext);
          // Cache read-file results for deduplication
          if (tc.name === "read_file" || tc.name === "Read") {
            readCache.set(loopKey, result);
          }
        }

        onEvent(taskId, {
          type: "tool_result",
          content: result.slice(0, 500),
        });

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }

      // After tool results, if the loop guard fired a hard stop, inject a user
      // message and disable tools on the next turn so the model must produce text.
      if (loopBreakTriggered) {
        messages.push({
          role: "user",
          content: "You have been caught in a tool-call loop. Stop using tools immediately. Write your complete final response as plain text right now.",
        });
        forceTextOnlyTurn = true;
      }
    } else {
      // No tool calls — model is done (or we forced a text-only turn)
      break;
    }

    // After a forced text-only turn the model can't call tools, so it will
    // always land in the branch above. Reset the flag defensively in case
    // the model somehow still returns tool calls (shouldn't happen, but safe).
    if (forceTextOnlyTurn) break;
  }

  return { code: 0, result: fullText.slice(-2000), turns, totalTokens, inputTokens, outputTokens };
}

/**
 * Spawn a generic (non-Claude) agent that calls an OpenAI-compatible API directly.
 * Returns an AgentProcess compatible with the existing agent-manager.
 */
export function spawnGenericAgent(
  taskId: string,
  description: string,
  projectPath: string,
  maxBudgetUsd: number,
  onEvent: AgentEventHandler,
  onExit: (taskId: string, code: number | null, signal: string | null) => void,
  provider: ModelProvider,
  modelId: string,
  agentType: string = "developer",
  project?: string,
  thinkingMode?: string
): AgentProcess {
  const controller = new AbortController();
  const pid = fakePidCounter--;
  const proc = new GenericProcess(pid, controller);

  const agent: AgentProcess = {
    proc: proc as unknown as ChildProcess,
    pid,
    taskId,
    projectPath,
    startedAt: new Date(),
    textBuffer: "",
    modelsUsed: [modelId],
  };

  // Emit init event
  onEvent(taskId, { type: "init", model: modelId });

  // Build tool context for delegation safety
  const toolContext: ToolContext = {
    parentTaskId: taskId,
    parentProject: project,
    currentAgentType: agentType,
  };

  // Start the agent loop asynchronously
  runAgentLoop(
    taskId,
    description,
    projectPath,
    provider,
    modelId,
    maxBudgetUsd,
    onEvent,
    controller,
    agent,
    agentType,
    toolContext,
    thinkingMode
  )
    .then(({ code, result, turns, totalTokens, inputTokens, outputTokens }) => {
      agent.lastResult = {
        cost: 0, // OpenAI-compat APIs don't report cost directly
        result,
        sessionId: taskId,
        turns,
        inputTokens,
        outputTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        contextWindow: 0,
      };
      // Emit result event
      onEvent(taskId, {
        type: "result",
        sessionId: taskId,
        cost: 0,
        result: totalTokens > 0 ? `${result}\n\n---\nTokens used: ${totalTokens.toLocaleString()}` : result,
        turns,
        inputTokens,
        outputTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        contextWindow: 0,
      });
      proc.exitCode = code;
      proc.emit("exit", code, null);
      onExit(taskId, code, null);
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      onEvent(taskId, { type: "error", content: msg });
      proc.exitCode = 1;
      proc.emit("exit", 1, null);
      onExit(taskId, 1, null);
    });

  return agent;
}
