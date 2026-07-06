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
import { availableLaneTools, capabilityRoutingGuide } from "./lane-tools";
import { verificationGatePrompt } from "./verification-gate";
import { runCodeSmoke } from "./code-smoke";
import { listSkills } from "@/lib/skills/store";
import { formatSkillIndex, skillRunsOn } from "@/lib/skills/contracts";
import { getAgentProfile } from "@/lib/config/agent-profiles";
import { buildBrainMemoryBundle, buildBrainIndexBlock } from "@/lib/brain/memory-bundle";
import { brainDocPolicyText } from "@/lib/brain/settings";
import { resolveThinkingMode } from "@/lib/config/budget-policy";

const MAX_TURNS = 50;
const MODEL_TOOL_RESULT_MAX_CHARS = 12_000;
const LOCAL_OPENAI_COMPATIBLE_PROVIDERS = new Set(["ollama", "lmstudio", "mlx", "vllm", "nanai"]);
// Providers HiveMatrix serves locally (Qwen). nanai is excluded — it's cloud
// image generation, not a self-hosted endpoint we wait on for cold start.
const LOCAL_SERVED_PROVIDERS = new Set(["ollama", "lmstudio", "mlx", "vllm"]);

// Loop-guard thresholds: how many identical tool calls before intervening
const LOOP_WARN_THRESHOLD = 3;  // inject "you already have this" into tool result
const LOOP_BREAK_THRESHOLD = 5; // also inject a user-turn forcing a final answer

// How many times the code-smoke gate may bounce a "done" back to the model to fix
// a crashing program before we give up and let the task end (reported as failed).
// Bounded so a model that can't fix its own bug can't loop forever.
const MAX_SMOKE_RETRIES = 2;

export function shouldRunCompletionSmokeGate(touchedFiles: readonly string[], _forceTextOnlyTurn: boolean): boolean {
  return touchedFiles.length > 0;
}

export function buildSmokeGateFinalResult(
  finalText: string,
  smokeRetries: number,
  smokeReport: string,
  maxSmokeRetries = MAX_SMOKE_RETRIES,
): { code: 0 | 1; result: string } {
  let result = finalText;
  const failedAfterRetries = smokeRetries >= maxSmokeRetries && !!smokeReport;
  if (failedAfterRetries) {
    result += `\n\n[Verification gate] Code still fails to run after ${maxSmokeRetries} fix attempts:\n${smokeReport.slice(0, 1500)}`;
  }
  return { code: failedAfterRetries ? 1 : 0, result };
}

export function modelToolResultContent(result: string, maxChars = MODEL_TOOL_RESULT_MAX_CHARS): string {
  if (result.length <= maxChars) return result;
  return `${result.slice(0, maxChars)}\n\n[truncated: tool result was ${result.length} chars; ask for a narrower read/search/listing with offset, limit, path, or glob if more detail is needed.]`;
}

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

export function genericDeliverableReliabilityInstruction(): string {
  return `--- Deliverable Reliability ---
- Preserve correctness before speed. Do not settle for the first idea when it produces brittle code, repeated failures, dead code, or fragile special-case probes.
- Prefer the standard library or existing project dependencies for small deliverables. Add a new dependency only when it materially improves the result and you have verified it imports and runs in this environment.
- For Python tasks, check the active interpreter first. Python 3.14 can have limited third-party wheel support; avoid native GUI/game packages such as pygame unless they are already working end-to-end.
- For simple Python games such as snake, pong, tetris, or breakout, do not create a venv or install packages unless the user explicitly asks. Use standard-library tkinter or a terminal/curses implementation.
- If a third-party package import, install, font, or native-extension support fails, pivot to a dependency-free standard-library implementation instead of repeatedly probing package internals.
- Do not run system-wide pip installs. Use a virtual environment only when a third-party dependency is truly required by the task and the user has not ruled it out.
- Do not claim completion until the final verification command passes. If the last command fails, fix it or report the blocker plainly instead of summarizing success.`;
}

async function buildSystemPrompt(projectPath: string, agentType: string, thinkingMode?: string | null): Promise<string> {
  const profile = getAgentProfile(agentType);
  let prompt = `${profile.systemPrompt}\n\n--- Brain Doc Policy ---\n${brainDocPolicyText()}`;
  // Chief-of-staff routing table: tell the agent which capability lane owns each
  // intent (email → Mail Lane, browser → Browser Lane, …) so it dispatches to the
  // right tool instead of improvising. Reflects only currently-available lanes.
  const routingGuide = capabilityRoutingGuide();
  if (routingGuide) {
    prompt += `\n\n${routingGuide}`;
  }
  // Skill library index, filtered to skills compatible with THIS harness (the
  // local/Qwen agent) — chief-of-staff awareness of skill compatibility. Bounded.
  const skillIndex = formatSkillIndex((await listSkills()).filter((s) => s.trusted && skillRunsOn(s.compat, "qwen")));
  if (skillIndex) {
    prompt += `\n\n${skillIndex}`;
  }
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
  // Always front-load the brain INDEX (projects + recent docs), so the model
  // knows the operator's brain exists and reaches for brain_search.
  const brainIndex = await buildBrainIndexBlock();

  // Add project directory context for profiles with tools
  if (profile.tools.length > 0) {
    prompt += `\n\nWorking directory: ${projectPath}`;
    prompt += `\n\n${genericDeliverableReliabilityInstruction()}`;
    // Code verification gate — same layer the Claude CLI bridge injects. Local
    // quantized models hallucinate API names more than frontier ones, so the
    // catch-and-correct pass matters most on exactly this path.
    prompt += `\n\n${verificationGatePrompt()}`;
  }

  if (memoryBundle) {
    prompt += memoryBundle;
  }
  if (brainIndex) {
    prompt += brainIndex;
  }

  // Inject the repo's AGENTS.md (the converged conventions standard) so the local
  // agent follows house style — it doesn't read AGENTS.md natively the way Codex does.
  if (profile.tools.length > 0) {
    const { readAgentsMd, formatAgentsMd } = await import("@/lib/conventions/agents-md");
    const agents = formatAgentsMd(await readAgentsMd(projectPath));
    if (agents) prompt += `\n\n${agents}`;
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
 * embedded capability lanes (Browser Lane / Desktop Lane) are appended —
 * but only the lanes the current connectivity mode permits, so the model is
 * never shown a tool it cannot use.
 */
function getProfileTools(agentType: string): ChatTool[] {
  const profile = getAgentProfile(agentType);
  const local = profile.tools.length === 0
    ? []
    : TOOL_DEFINITIONS.filter((t) => profile.tools.includes(t.function.name));
  return [...local, ...availableLaneTools()];
}

/**
 * Build the OpenAI messages array for the initial request.
 */
export async function buildMessages(
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

interface TextToolCall {
  name: string;
  arguments: string;
}

const TEXT_TOOL_NAME_ALIASES: Record<string, string> = {
  Bash: "bash",
  Read: "read_file",
  Write: "write_file",
  Edit: "edit_file",
  Grep: "search",
  Glob: "list_files",
};

function normalizeTextToolName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  return TEXT_TOOL_NAME_ALIASES[name] ?? name;
}

function normalizeTextToolPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.startsWith("/home/user/hivematrix/")) {
    return trimmed.slice("/home/user/hivematrix/".length);
  }
  if (trimmed === "/home/user/hivematrix") return ".";
  return trimmed === "~" || trimmed === "." ? "." : trimmed;
}

function escapeRegexTerm(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function searchPatternFromTextQuery(query: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(query.replace(/\+/g, " "));
    } catch {
      return query;
    }
  })();
  const terms = decoded
    .split(/[\s,/]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .map(escapeRegexTerm);
  return terms.length ? terms.join("|") : escapeRegexTerm(decoded.trim());
}

function readBalancedJsonObject(text: string, start: number): { raw: string; end: number } | null {
  if (text[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return { raw: text.slice(start, i + 1), end: i + 1 };
      }
    }
  }
  return null;
}

export function extractTextToolCalls(text: string): { content: string; toolCalls: TextToolCall[] } {
  const marker = "..TOOL";
  const toolCalls: TextToolCall[] = [];
  let content = "";
  let cursor = 0;

  while (cursor < text.length) {
    const markerAt = text.indexOf(marker, cursor);
    if (markerAt === -1) {
      content += text.slice(cursor);
      break;
    }

    const objectStart = text.indexOf("{", markerAt + marker.length);
    if (objectStart === -1) {
      content += text.slice(cursor);
      break;
    }

    const parsedObject = readBalancedJsonObject(text, objectStart);
    if (!parsedObject) {
      content += text.slice(cursor);
      break;
    }

    content += text.slice(cursor, markerAt);
    cursor = parsedObject.end;

    try {
      const payload = JSON.parse(parsedObject.raw) as Record<string, unknown>;
      const name = normalizeTextToolName(payload.name);
      const args = payload.args && typeof payload.args === "object"
        ? payload.args
        : {};
      if (name) {
        toolCalls.push({ name, arguments: JSON.stringify(args) });
      }
    } catch {
      content += text.slice(markerAt, parsedObject.end);
    }
  }

  content = content.replace(
    /^\s*\[find\]\s+path:\s+`([^`]+)`,\s+regex:\s+`([^`]+)`\s*$/gm,
    (_match, path: string, pattern: string) => {
      toolCalls.push({
        name: "search",
        arguments: JSON.stringify({ path: normalizeTextToolPath(path), pattern }),
      });
      return "";
    }
  );

  content = content.replace(
    /\[~\{type:'bash',\s*cmd:'((?:\\'|[^'])*)',\s*out:'true'\}\]/g,
    (_match, command: string) => {
      toolCalls.push({
        name: "bash",
        arguments: JSON.stringify({ command: command.replace(/\\'/g, "'") }),
      });
      return "";
    }
  );

  content = content.replace(
    /\[brain_search\?q=([^\]\n]+)\]/g,
    (_match, query: string) => {
      toolCalls.push({
        name: "search",
        arguments: JSON.stringify({ path: ".", pattern: searchPatternFromTextQuery(query) }),
      });
      return "";
    }
  );

  content = content.replace(
    /\[brain_search\]\s*q:([^\n]+)/g,
    (_match, query: string) => {
      toolCalls.push({
        name: "search",
        arguments: JSON.stringify({ path: ".", pattern: searchPatternFromTextQuery(query) }),
      });
      return "";
    }
  );

  content = content.replace(
    /```(?:bash|sh|zsh|shell)\s*\n([\s\S]*?)```/g,
    (_match, command: string) => {
      const trimmed = command.trim();
      if (!trimmed) return "";
      const readFile = trimmed.match(/^read\s+file\s+(.+)$/i);
      if (readFile) {
        toolCalls.push({
          name: "read_file",
          arguments: JSON.stringify({ path: readFile[1].trim() }),
        });
        return "";
      }
      toolCalls.push({
        name: "bash",
        arguments: JSON.stringify({ command: trimmed }),
      });
      return "";
    }
  );

  content = content.replace(
    /```python\s*\n\s*read_file\(path=(["'])(.*?)\1\)\s*```/g,
    (_match, _quote: string, path: string) => {
      toolCalls.push({
        name: "read_file",
        arguments: JSON.stringify({ path: normalizeTextToolPath(path) }),
      });
      return "";
    }
  );

  return { content: content.replace(/\n{3,}/g, "\n\n").trim(), toolCalls };
}

export function buildGenericRequestBody(
  provider: ModelProvider,
  modelId: string,
  messages: Array<Record<string, unknown>>,
  profileTools?: ChatTool[],
  thinkingMode?: string | null
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
  profileTools?: ChatTool[],
  thinkingMode?: string | null
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (provider.apiKey) {
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
  }

  const body = buildGenericRequestBody(provider, modelId, messages, profileTools, thinkingMode);
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

  // Pre-flight: if this is a locally-served model (Qwen), make sure the server is
  // actually up before we start. The supervisor relaunches a crashed server on a
  // ~12s throttle and an 80B model takes time to load — without this wait a task
  // dispatched in that window fails with a cryptic connection error and looks
  // like "Qwen randomly doesn't work". Wait through the cold-start instead.
  if (LOCAL_SERVED_PROVIDERS.has(provider.name)) {
    const { isServerUp, waitForServerReady } = await import("@/lib/local-model/serving");
    if (!(await isServerUp(provider.endpoint))) {
      onEvent(taskId, { type: "error", content: `Local model server not ready at ${provider.endpoint} — waiting for it to come up (supervisor is (re)launching it)…` });
      const ready = await waitForServerReady(provider.endpoint, { timeoutMs: 45_000, signal: controller.signal });
      if (controller.signal.aborted) {
        return { code: 1, result: "Aborted", turns: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0 };
      }
      if (!ready) {
        const msg = `Local model (Qwen) at ${provider.endpoint} did not become reachable within 45s. Check that the inference server is configured to launch (config qwen.location="local" + a valid provider/serveCommand) and that the model fits in memory. Connectivity mode determines whether this task can fall back to frontier.`;
        onEvent(taskId, { type: "error", content: msg });
        return { code: 1, result: msg, turns: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0 };
      }
    }
  }

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
  // Deterministic verification-gate bookkeeping: how many times we've bounced a
  // "done" back for a crashing smoke run, and whether the last run was clean.
  let smokeRetries = 0;
  let smokeReport = "";

  while (turns < MAX_TURNS) {
    if (controller.signal.aborted) {
      return { code: 1, result: "Aborted", turns, totalTokens, inputTokens, outputTokens };
    }

    turns++;

    // Call API with single retry on transient errors (429, 500, 502, 503)
    let response: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await callChatCompletions(provider, modelId, messages, controller.signal, forceTextOnlyTurn ? [] : profileTools, thinkingMode);
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
            if (!agent.firstTokenAt && event.content) agent.firstTokenAt = new Date();
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

    const textTools = extractTextToolCalls(cleanTurnText);
    fullText += textTools.content || cleanTurnText;
    const usage = getUsage(state);
    totalTokens += usage.totalTokens;
    inputTokens += usage.promptTokens;
    outputTokens += usage.completionTokens;

    // Get completed tool calls from this turn
    const toolCalls = getCompletedToolCalls(state);
    const effectiveToolCalls = toolCalls.length > 0 ? toolCalls : textTools.toolCalls;

    if ((toolCalls.length > 0 && hasToolCalls) || textTools.toolCalls.length > 0) {
      // Add assistant message with tool calls to conversation
      if (toolCalls.length > 0 && hasToolCalls) {
        messages.push({
          role: "assistant",
          content: cleanTurnText || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });
      } else {
        messages.push({
          role: "assistant",
          content: textTools.content || "I will use the available tools.",
        });
      }

      let loopBreakTriggered = false;
      const textToolResults: string[] = [];

      // Execute each tool call and add results
      for (const tc of effectiveToolCalls) {
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

        const modelResult = modelToolResultContent(result);
        onEvent(taskId, {
          type: "tool_result",
          content: result.slice(0, 500),
        });

        if ("id" in tc) {
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: modelResult,
          });
        } else {
          textToolResults.push(`Tool result for ${tc.name}:\n${modelResult}`);
        }
      }

      if (textToolResults.length > 0) {
        messages.push({
          role: "user",
          content: textToolResults.join("\n\n"),
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
      // No tool calls — model claims it's done. Before accepting that, run the
      // deterministic verification gate: execute any Python files it touched in a
      // real pseudo-terminal. This catches runtime crashes (e.g. the curses
      // bottom-right-corner `addwstr() returned ERR`) that py_compile/import/mypy
      // all pass. On a crash, feed the traceback back and force a fix — up to a
      // bounded number of times so a model that can't self-repair still terminates.
      const touched = toolContext?.touchedFiles ? [...toolContext.touchedFiles] : [];
      if (shouldRunCompletionSmokeGate(touched, forceTextOnlyTurn)) {
        const smoke = await runCodeSmoke(projectPath, touched);
        if (smoke.ran && !smoke.ok) {
          smokeReport = smoke.report; // remember the crash for the final summary
          if (smokeRetries < MAX_SMOKE_RETRIES) {
            smokeRetries += 1;
            forceTextOnlyTurn = false;
            onEvent(taskId, {
              type: "tool_result",
              content: `[Verification gate] smoke run failed (attempt ${smokeRetries}/${MAX_SMOKE_RETRIES}); sending crash back to the model.`,
            });
            messages.push({ role: "user", content: smoke.report });
            continue; // keep tools enabled so the model can fix the code
          }
          // Retries exhausted: finish with a nonzero exit so the task lands as
          // failed instead of review/done.
          break;
        }
        smokeReport = ""; // clean run (or nothing crashed) — no failure to surface
      }
      // Passed the gate (or nothing to verify): model is done.
      break;
    }
  }

  // If the code never passed the smoke gate, surface it in the result so the task
  // is not reported as a clean success on top of code that crashes when run.
  const finalResult = buildSmokeGateFinalResult(fullText.slice(-2000), smokeRetries, smokeReport);

  return { code: finalResult.code, result: finalResult.result, turns, totalTokens, inputTokens, outputTokens };
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
    touchedFiles: new Set<string>(),
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
