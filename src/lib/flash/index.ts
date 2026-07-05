/**
 * Flash Lane — public API.
 *
 * Entry point for daemon routes. Coordinates session management, context
 * assembly, the agent loop, and SSE emission into a single `handleFlashTurn`
 * call. The HTTP response object is passed in as a writer so this module has
 * no import dependency on the daemon.
 */

import type { ServerResponse } from "http";
import { configuredBrainRootDir } from "@/lib/brain/settings";
import { generateId } from "@/lib/db";
import type { FlashEmitter, FlashTurnInput } from "./types";
import {
  appendFeedbackToTurn,
  appendTurn,
  createSession,
  getOrCreateSession,
  getRecentTurns,
  getSession,
  getTurnsForSession,
  listSessions,
} from "./store";
import { assembleSystemPrompt, buildInitialMessages } from "./context";
import { runFlashAgentLoop } from "./loop";

// Re-export store helpers for the server routes
export { appendFeedbackToTurn, createSession, getSession, getTurnsForSession, listSessions };

/**
 * Run a flash turn and return the reply directly (no SSE).
 * Used by /voice/turn as a thin alias for watch/glasses clients that expect
 * a JSON response rather than an SSE stream.
 */
export async function runFlashTurnText(opts: {
  text: string;
  channel: FlashTurnInput["channel"];
  peer: string;
  sessionId?: string;
  /** Restrict which tools this turn may use (offer + dispatch). */
  allowedTools?: (name: string) => boolean;
}): Promise<{ reply: string; sessionId: string; turnId: string }> {
  const brainRoot = configuredBrainRootDir();
  const session = getOrCreateSession(opts.channel, opts.peer, opts.sessionId);

  appendTurn(session.id, "user", opts.text);

  const recentTurns = getRecentTurns(session.id, 20);
  const systemPrompt = await assembleSystemPrompt(opts.text, session.summary, brainRoot, opts.channel);
  const historyTurns = recentTurns.filter((t) => !(t.role === "user" && t.content === opts.text));
  const messages = buildInitialMessages(systemPrompt, historyTurns, opts.text);

  const emit: FlashEmitter = {
    token: () => {},
    toolStart: () => {},
    toolResult: () => {},
    escalated: () => {},
    done: () => {},
  };

  const fullText = await runFlashAgentLoop(messages, emit, session.id, brainRoot, {
    allowedTools: opts.allowedTools,
  });
  const assistantTurn = appendTurn(session.id, "assistant", fullText);
  return { reply: fullText, sessionId: session.id, turnId: assistantTurn.id };
}

function writeSse(res: ServerResponse, event: string, data: unknown): void {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Client disconnected — ignore
  }
}

export async function handleFlashTurn(
  body: Record<string, unknown>,
  res: ServerResponse,
): Promise<void> {
  const input: FlashTurnInput = {
    sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
    channel: (typeof body.channel === "string" ? body.channel : "console") as FlashTurnInput["channel"],
    peer: typeof body.peer === "string" && body.peer ? body.peer : "operator",
    text: typeof body.text === "string" ? body.text : "",
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
  };

  if (!input.text.trim()) {
    writeSse(res, "error", { message: "text is required" });
    return;
  }

  const brainRoot = configuredBrainRootDir();
  const session = getOrCreateSession(input.channel, input.peer, input.sessionId);

  // Persist the user turn before the loop so it is available for context assembly
  appendTurn(session.id, "user", input.text);

  // Context: persona + daily note + brain search + rolling session summary + turns
  const recentTurns = getRecentTurns(session.id, 20);
  const systemPrompt = await assembleSystemPrompt(input.text, session.summary, brainRoot, input.channel);
  // Exclude the turn we just appended (it's already the last user message)
  const historyTurns = recentTurns.filter((t) => !(t.role === "user" && t.content === input.text));
  const messages = buildInitialMessages(systemPrompt, historyTurns, input.text);

  const emit: FlashEmitter = {
    token: (delta) => writeSse(res, "token", { delta }),
    toolStart: (name, args_summary) => writeSse(res, "tool_start", { name, args_summary }),
    toolResult: (name, ok, summary) => writeSse(res, "tool_result", { name, ok, summary }),
    escalated: (workPackageId) => writeSse(res, "escalated", { workPackageId }),
    done: (sessionId, turnId, fullText, audioRef) =>
      writeSse(res, "done", { sessionId, turnId, fullText, ...(audioRef ? { audioRef } : {}) }),
  };

  const fullText = await runFlashAgentLoop(messages, emit, session.id, brainRoot);

  // Persist the assistant's full response
  const assistantTurn = appendTurn(session.id, "assistant", fullText);

  emit.done(session.id, assistantTurn.id, fullText);
}

/** Append a bad-turn regression case to the parity eval set. */
export async function recordBadTurnForEval(
  sessionId: string,
  turnId: string,
  fullText: string,
): Promise<void> {
  const { appendFileSync, mkdirSync } = await import("fs");
  const { join } = await import("path");
  const { homedir } = await import("os");

  const evalDir = join(homedir(), "hivematrix", "eval", "flash-parity");
  mkdirSync(evalDir, { recursive: true });

  const record = JSON.stringify({
    id: generateId(),
    sessionId,
    turnId,
    prompt: fullText,
    context: "operator-marked-bad",
    expected_behavior: "should produce a better response",
    addedAt: new Date().toISOString(),
  });

  appendFileSync(join(evalDir, "prompts.jsonl"), record + "\n", "utf-8");
}
