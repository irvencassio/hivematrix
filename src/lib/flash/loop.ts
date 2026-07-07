/**
 * Flash Lane — agent loop with streaming SSE output.
 *
 * Calls the local Qwen model via LM Studio (OpenAI-compatible streaming).
 * Tool calls are accumulated across streaming chunks, executed, and results
 * fed back into the next model call. Budget: 12 tool calls / 3 min wall clock.
 *
 * Flash-only tools (persona_update, escalate_to_task) live here;
 * the rest delegate to the existing lane-tools dispatcher.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getQwenProfile } from "@/lib/config/qwen-profile";
import { availableLaneTools, executeLaneTool } from "@/lib/orchestrator/lane-tools";
import { broadcastEvent } from "@/lib/ws/broadcaster";
import { getConnectivityPolicy } from "@/lib/connectivity/policy";
import type { FlashEmitter, FlashMessage, StreamEvent, ToolCallRecord } from "./types";

const MAX_TOOL_CALLS = 12;
const MAX_WALL_MS = 3 * 60 * 1000;
const MODEL_TIMEOUT_MS = 120_000;

/** Consecutive identical sentences before we call it a degenerate repetition loop. */
export const REPEAT_LIMIT = 4;

/** Split text into trimmed sentence/line units (on . ! ? or newline). */
function sentenceUnits(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Pure: is the model degenerating into repetition? True when the last substantive
 * sentence has repeated >= REPEAT_LIMIT times in a row at the tail. A small local
 * model with no repetition penalty can loop a sentence up to max_tokens — this lets
 * the stream stop early instead of showing the operator a wall of the same line.
 */
export function isRepeatingTail(text: string, limit = REPEAT_LIMIT): boolean {
  const units = sentenceUnits(text);
  if (units.length < limit) return false;
  const last = units[units.length - 1];
  if (last.length < 20) return false; // ignore short interjections ("ok.", "yes.")
  let run = 0;
  for (let i = units.length - 1; i >= 0 && units[i] === last; i--) run++;
  return run >= limit;
}

/** Pure: collapse a run of >= limit identical trailing sentences down to one, so a
 *  degenerate generation isn't stored verbatim in the conversation history. */
export function collapseRepetition(text: string, limit = REPEAT_LIMIT): string {
  const units = sentenceUnits(text);
  if (units.length < limit) return text;
  const last = units[units.length - 1];
  let run = 0;
  for (let i = units.length - 1; i >= 0 && units[i] === last; i--) run++;
  if (run < limit) return text;
  const kept = units.slice(0, units.length - run + 1); // keep exactly one copy
  return kept.join(" ");
}

// ------------------------------------------------------------------
// Flash-only tool definitions
// ------------------------------------------------------------------

const FLASH_ONLY_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "persona_update",
      description:
        "Write a persona file (SOUL.md, IDENTITY.md, USER.md, or GOALS.md) in the brain persona directory. " +
        "Use when the operator asks to update identity/persona, or to record a goal they state in GOALS.md. " +
        "Every call emits a visible notice and an audit event.",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", enum: ["SOUL.md", "IDENTITY.md", "USER.md", "GOALS.md"] },
          content: { type: "string", description: "Full new content for the file" },
          reason: { type: "string", description: "Brief reason shown to the operator" },
        },
        required: ["file", "content", "reason"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "generate_avatar",
      description:
        "Generate an avatar image and save it as the persona avatar (persona/avatar.png). " +
        "Use during the birth ritual when the agent is choosing its visual identity. " +
        "Accepts an image generation prompt describing the desired image.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Concrete visual description for the image generator (shape, colors, style)" },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "deep_think",
      description:
        "Deep reasoning for HARD questions: runs several independent attempts on the local model, " +
        "cross-checks them for agreement, and reconciles disagreements with a skeptical revision pass. " +
        "Slow (1-3 minutes) but far more reliable than a single answer. Use for strategy decisions, " +
        "tricky analysis, math/logic, or anything where a wrong answer is costly. " +
        "NOT for simple lookups, casual chat, or things a tool can answer directly.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question, fully self-contained — include all context needed to answer it, since this runs fresh without the conversation history.",
          },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "escalate_to_task",
      description:
        "Escalate a complex multi-step request to a background task (the coding harness plans and executes it). " +
        "Use when the task cannot be completed in a single conversation turn.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title for the task" },
          description: { type: "string", description: "Full description of what needs to be done" },
          projectPath: { type: "string", description: "Absolute path to the project (optional)" },
        },
        required: ["title", "description"],
      },
    },
  },
];

// ------------------------------------------------------------------
// LM Studio streaming client
// ------------------------------------------------------------------

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

function candidateUrls(endpoint: string): string[] {
  const base = normalizeEndpoint(endpoint);
  const path = "chat/completions";
  return base.endsWith("/v1")
    ? [`${base}/${path}`]
    : [`${base}/v1/${path}`, `${base}/${path}`];
}

async function* streamFromLocalModel(
  messages: FlashMessage[],
  tools: unknown[],
  endpoint: string,
  modelId: string,
): AsyncGenerator<StreamEvent> {
  let response: Response | null = null;
  const body = JSON.stringify({
    model: modelId,
    messages,
    stream: true,
    temperature: 0.7,
    max_tokens: 2048,
    // Discourage the local model from looping a phrase (esp. when it wants a
    // capability it lacks). OpenAI-compatible; ignored by servers that don't support it.
    frequency_penalty: 0.4,
    presence_penalty: 0.3,
    ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
  });

  for (const url of candidateUrls(endpoint)) {
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      });
      if (response.status !== 404) break;
      response = null;
    } catch (err) {
      // Propagate timeouts; retry next URL on connection errors
      if (err instanceof Error && /timeout|abort/i.test(err.message)) throw err;
      response = null;
    }
  }

  if (!response) throw new Error("Flash model: all candidate URLs unreachable");
  if (!response.ok) throw new Error(`Flash model HTTP ${response.status}`);
  if (!response.body) throw new Error("Flash model: empty response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6).trim();
        if (data === "[DONE]") { yield { type: "done", finishReason: "stop" }; return; }

        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(data) as Record<string, unknown>; } catch { continue; }

        const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
        if (!choices?.length) continue;

        const choice = choices[0] as Record<string, unknown>;
        const delta = choice.delta as Record<string, unknown> | undefined;
        const finishReason = choice.finish_reason as string | null | undefined;

        if (delta?.content && typeof delta.content === "string") {
          yield { type: "token", content: delta.content };
        }

        const toolCalls = delta?.tool_calls as Array<Record<string, unknown>> | undefined;
        if (toolCalls) {
          for (const tc of toolCalls) {
            const fn = tc.function as Record<string, unknown> | undefined;
            yield {
              type: "tool_call_delta",
              index: (tc.index as number) ?? 0,
              id: tc.id as string | undefined,
              name: fn?.name as string | undefined,
              arguments: fn?.arguments as string | undefined,
            };
          }
        }

        if (finishReason) {
          yield { type: "done", finishReason };
          return;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  yield { type: "done", finishReason: "stop" };
}

// ------------------------------------------------------------------
// Flash-only tool handlers
// ------------------------------------------------------------------

async function handlePersonaUpdate(
  args: Record<string, unknown>,
  emit: FlashEmitter,
  brainRoot: string | null,
): Promise<string> {
  const file = String(args.file ?? "");
  const content = String(args.content ?? "");
  const reason = String(args.reason ?? "");

  if (!["SOUL.md", "IDENTITY.md", "USER.md", "GOALS.md"].includes(file)) {
    return `Error: invalid persona file "${file}" — must be SOUL.md, IDENTITY.md, USER.md, or GOALS.md`;
  }
  if (!brainRoot) return "Error: brain root not configured";

  const dir = join(brainRoot, "persona");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file);

  if (existsSync(path)) {
    // Keep a timestamped backup in the same directory
    const backup = join(dir, `${file}.${Date.now()}.bak`);
    const { readFileSync } = await import("fs");
    writeFileSync(backup, readFileSync(path));
  }

  writeFileSync(path, content, "utf-8");
  broadcastEvent("flash:persona_updated", { file, reason, ts: new Date().toISOString() });

  const notice = `\n\n[Persona updated: ${file} — ${reason}]\n`;
  emit.token(notice);

  return `persona_update: ${file} written (${content.length} chars). Reason: ${reason}`;
}

async function handleGenerateAvatar(
  args: Record<string, unknown>,
  brainRoot: string | null,
): Promise<string> {
  const prompt = String(args.prompt ?? "").trim();
  if (!prompt) return "Error: prompt is required";
  if (!brainRoot) return "Error: brain root not configured";

  const dir = join(brainRoot, "persona");
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, "avatar.png");

  const mode = getConnectivityPolicy().mode;
  const { generateViaNanai, generateViaMflux } = await import("@/lib/orchestrator/image-gen");

  let result: { ok: boolean; detail: string };
  if (mode === "cloud-ok") {
    result = await generateViaNanai(prompt, outPath);
    if (!result.ok) result = await generateViaMflux(prompt, outPath);
  } else {
    result = await generateViaMflux(prompt, outPath);
  }

  if (result.ok) {
    broadcastEvent("flash:persona_updated", { file: "avatar.png", reason: "avatar generated", ts: new Date().toISOString() });
    return `Avatar generated at ${outPath}`;
  }
  return `Avatar generation attempted but failed: ${result.detail}. You can describe yourself in text instead — the operator can add an image manually later.`;
}

async function handleDeepThink(args: Record<string, unknown>): Promise<string> {
  const question = String(args.question ?? "").trim();
  if (!question) return "Error: question is required";
  const { deepThink } = await import("@/lib/models/deep-think");
  // Bounded to fit inside the flash turn budget (3 min wall): 3 rollouts,
  // 60s per call, 150s total. The result carries calibration metadata so the
  // model can present the answer with honest confidence.
  const r = await deepThink(question, { samples: 3, callTimeoutMs: 60_000, maxWallMs: 150_000 });
  return (
    `${r.answer}\n\n` +
    `[deep-think: ${r.candidates} attempts, ${Math.round(r.agreement * 100)}% agreement, ` +
    `confidence ${r.confidence}${r.reflected ? ", revised after disagreement" : ""}, ${Math.round(r.elapsedMs / 1000)}s]`
  );
}

async function handleEscalateToTask(
  args: Record<string, unknown>,
  emit: FlashEmitter,
  sessionId: string,
): Promise<string> {
  const { Task, generateId } = await import("@/lib/db");

  const title = String(args.title ?? "Task");
  const description = String(args.description ?? "");
  const projectPath = String(args.projectPath ?? homedir());

  // Broad multi-step work dispatches as a SINGLE task that self-plans via
  // Superpowers: workflow:"work" triggers the "/workflows:work" skill prefix so
  // the frontier coding harness plans and executes its own subtasks.
  const task = await Task.create({
    _id: generateId(),
    title,
    description,
    project: "hivematrix",
    projectPath,
    executor: "agent",
    model: "mixed",
    workflow: "work",
    source: `flash:${sessionId}`,
  });

  emit.escalated(task._id);
  return `Escalated to task ${task._id}: "${title}"`;
}

// ------------------------------------------------------------------
// Main agent loop
// ------------------------------------------------------------------

/**
 * Read-only tool names — the set an observe-only pass (manual-autonomy
 * heartbeat, daily briefs) is allowed to call. HARD enforcement: gating the
 * tool list is the guarantee; prompt guidance alone is not (the prompt embeds
 * operator-editable and inbound-derived text).
 */
export const READ_ONLY_FLASH_TOOLS: ReadonlySet<string> = new Set([
  "brain_search",
  "workflow_inbox",
  "code_graph",
]);

export interface FlashLoopOptions {
  /** When set, only tools passing the filter are OFFERED to the model. */
  allowedTools?: (name: string) => boolean;
}

export async function runFlashAgentLoop(
  messages: FlashMessage[],
  emit: FlashEmitter,
  sessionId: string,
  brainRoot: string | null,
  options: FlashLoopOptions = {},
): Promise<string> {
  const profile = getQwenProfile();
  if (!profile) {
    const msg = "No local model configured. Please set up Qwen in Settings → Local Model.";
    emit.token(msg);
    return msg;
  }

  const policy = getConnectivityPolicy();
  const laneTools = availableLaneTools(policy);
  let allTools = [...laneTools, ...FLASH_ONLY_TOOLS];
  if (options.allowedTools) {
    allTools = allTools.filter((t) => options.allowedTools!(t.function.name));
  }

  const ctx = {
    projectPath: brainRoot ?? homedir(),
    project: "hivematrix",
    requestedBy: `flash:${sessionId}`,
  };

  const currentMessages = [...messages];
  let toolCallDepth = 0;
  const startTime = Date.now();
  let fullText = "";

  while (toolCallDepth < MAX_TOOL_CALLS && Date.now() - startTime < MAX_WALL_MS) {
    const accumulatedTools = new Map<number, ToolCallRecord>();
    let turnText = "";
    let finishReason = "stop";
    let degenerated = false;

    try {
      for await (const event of streamFromLocalModel(
        currentMessages,
        allTools,
        profile.primary.endpoint,
        profile.primary.modelId,
      )) {
        if (event.type === "token") {
          turnText += event.content;
          fullText += event.content;
          emit.token(event.content);
          // Stop a runaway repetition loop early instead of streaming the same
          // sentence up to max_tokens. Only check on a sentence boundary (cheap).
          if (/[.!?\n]/.test(event.content) && isRepeatingTail(turnText)) {
            degenerated = true;
            break;
          }
        } else if (event.type === "tool_call_delta") {
          const existing = accumulatedTools.get(event.index) ?? {
            id: event.id ?? `call_${event.index}`,
            type: "function" as const,
            function: { name: event.name ?? "", arguments: "" },
          };
          if (event.id) existing.id = event.id;
          if (event.name) existing.function.name = event.name;
          if (event.arguments) existing.function.arguments += event.arguments;
          accumulatedTools.set(event.index, existing);
        } else if (event.type === "done") {
          finishReason = event.finishReason;
        }
      }
    } catch (err) {
      const errMsg = `\n\n[Flash model error: ${err instanceof Error ? err.message : String(err)}]`;
      emit.token(errMsg);
      return fullText + errMsg;
    }

    // The model looped a sentence — end the turn now and collapse the repeated tail
    // out of the returned text (the client already saw the emitted tokens, but the
    // stored history and any summary shouldn't carry the wall of duplicates).
    if (degenerated) {
      return collapseRepetition(fullText);
    }

    const toolCalls = [...accumulatedTools.values()].filter((tc) => tc.function.name);

    if (finishReason !== "tool_calls" || toolCalls.length === 0) {
      return fullText;
    }

    // Push the assistant's tool-call turn into the message history
    currentMessages.push({ role: "assistant", content: turnText || null, tool_calls: toolCalls });

    for (const tc of toolCalls) {
      const name = tc.function.name;
      let argsObj: Record<string, unknown> = {};
      try { argsObj = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>; } catch { /* */ }

      emit.toolStart(name, JSON.stringify(argsObj).slice(0, 300));

      let result: string;
      let ok = true;

      try {
        // Execution-time gate too: a model can emit a call for a tool it was
        // never offered; the filter must hold at dispatch, not just at offer.
        if (options.allowedTools && !options.allowedTools(name)) {
          throw new Error(`tool ${name} is not permitted in this pass`);
        }
        if (name === "persona_update") {
          result = await handlePersonaUpdate(argsObj, emit, brainRoot);
        } else if (name === "deep_think") {
          result = await handleDeepThink(argsObj);
        } else if (name === "generate_avatar") {
          result = await handleGenerateAvatar(argsObj, brainRoot);
        } else if (name === "escalate_to_task") {
          result = await handleEscalateToTask(argsObj, emit, sessionId);
        } else {
          result = await executeLaneTool(name, argsObj, ctx);
        }
      } catch (err) {
        ok = false;
        result = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }

      emit.toolResult(name, ok, result.slice(0, 400));

      currentMessages.push({ role: "tool", content: result, tool_call_id: tc.id });
      toolCallDepth++;
    }
  }

  // Budget exhausted — summarise and offer escalation
  const elapsedS = Math.round((Date.now() - startTime) / 1000);
  const budgetMsg = `\n\n[Budget reached: ${toolCallDepth} tool calls in ${elapsedS}s. Use "escalate this to a task" for longer tasks.]`;
  emit.token(budgetMsg);
  return fullText + budgetMsg;
}
