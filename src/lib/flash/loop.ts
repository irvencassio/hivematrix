/**
 * Flash Lane — agent loop with streaming SSE output.
 *
 * Calls the local Qwen model via LM Studio (OpenAI-compatible streaming).
 * Tool calls are accumulated across streaming chunks, executed, and results
 * fed back into the next model call. Budget: 12 tool calls / 3 min wall clock.
 *
 * Flash-only tools (persona_update, escalate_to_work_package) live here;
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
      name: "escalate_to_work_package",
      description:
        "Escalate a complex multi-step request to a Work Package for structured agent execution. " +
        "Use when the task cannot be completed in a single conversation turn.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title for the work package" },
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

async function handleEscalateToWorkPackage(
  args: Record<string, unknown>,
  emit: FlashEmitter,
  sessionId: string,
): Promise<string> {
  const { classifyIntake } = await import("@/lib/intake/classify");
  const { createWorkPackage } = await import("@/lib/work-packages/store");

  const title = String(args.title ?? "Work Package");
  const description = String(args.description ?? "");
  const projectPath = String(args.projectPath ?? homedir());

  const intake = classifyIntake({ description, projectPath });
  const items = intake.packageCandidate?.items ?? [{ title, prompt: description, risk: "low" as const, executionMode: "run_now" as const, dependsOn: [], scopeHints: [] }];

  const pkg = createWorkPackage({
    title,
    description,
    project: "hivematrix",
    projectPath,
    sourceTaskId: `flash:${sessionId}`,
    intake,
    items,
  });

  emit.escalated(pkg.id);
  return `Escalated to work package ${pkg.id}: "${title}"`;
}

// ------------------------------------------------------------------
// Main agent loop
// ------------------------------------------------------------------

export async function runFlashAgentLoop(
  messages: FlashMessage[],
  emit: FlashEmitter,
  sessionId: string,
  brainRoot: string | null,
): Promise<string> {
  const profile = getQwenProfile();
  if (!profile) {
    const msg = "No local model configured. Please set up Qwen in Settings → Local Model.";
    emit.token(msg);
    return msg;
  }

  const policy = getConnectivityPolicy();
  const laneTools = availableLaneTools(policy);
  const allTools = [...laneTools, ...FLASH_ONLY_TOOLS];

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
        if (name === "persona_update") {
          result = await handlePersonaUpdate(argsObj, emit, brainRoot);
        } else if (name === "generate_avatar") {
          result = await handleGenerateAvatar(argsObj, brainRoot);
        } else if (name === "escalate_to_work_package") {
          result = await handleEscalateToWorkPackage(argsObj, emit, sessionId);
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
  const budgetMsg = `\n\n[Budget reached: ${toolCallDepth} tool calls in ${elapsedS}s. Use "escalate this to a work package" for longer tasks.]`;
  emit.token(budgetMsg);
  return fullText + budgetMsg;
}
