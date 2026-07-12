/**
 * Flash Lane — type definitions.
 *
 * Flash is the native ad-hoc conversational agent loop: per-channel-peer session
 * scoping, SSE-streamed responses, tool execution with budget gating, and a
 * learning loop that distills sessions into reusable skills.
 *
 * Scope rule: flash/ may import from routing/, orchestrator/, brain/, skills/, db/,
 * observability/, connectivity/ (the latter two for per-turn telemetry — see
 * loop.ts's recordFlashTelemetry, the Flash-lane counterpart to
 * agent-manager's captureRunTelemetry for orchestrator tasks).
 * Only daemon/ may import from flash/.
 */

export type FlashChannel = "console" | "voice" | "imessage" | "mail" | "watch" | "glasses" | "android";

export interface FlashTurnInput {
  sessionId?: string;
  channel: FlashChannel;
  peer: string;
  text: string;
  attachments?: unknown[];
  /** Local, already-normalized (flash/images.ts) image paths for this turn —
   *  the wire format (POST /flash/turn's `imagesBase64`) is decoded to these
   *  paths by the server route before handleFlashTurn ever sees the body. */
  imagePaths?: string[];
}

export interface FlashSessionRow {
  id: string;
  channel: string;
  peer: string;
  summary: string;
  createdAt: string;
  lastActiveAt: string;
  distilledAt?: string | null;
  /** The `claude` CLI's own session id, for `--resume` continuity — null until
   *  the first turn's stream-json `session` event is captured, and cleared
   *  whenever a `--resume` attempt turns out to be stale. */
  cliSessionId?: string | null;
}

export interface FlashTurnRow {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  toolCallsJson: string | null;
  artifactsJson: string | null;
  ts: string;
}

/** SSE emitter contract — one per HTTP request lifetime. */
export interface FlashEmitter {
  token(delta: string): void;
  toolStart(name: string, args_summary: string): void;
  toolResult(name: string, ok: boolean, summary: string): void;
  escalated(taskId: string): void;
  done(sessionId: string, turnId: string, fullText: string, audioRef?: string): void;
}

/**
 * Extended message type for the Flash agent loop, supporting tool calls and
 * tool results in addition to the basic system/user/assistant roles.
 */
export type FlashMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCallRecord[] }
  | { role: "tool"; content: string; tool_call_id: string };

export interface ToolCallRecord {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
