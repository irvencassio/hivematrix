/**
 * OpenClaw bridge — narrow proxy for Gateway WebSocket operations.
 * Keeps OpenClaw credentials server-side; browser code never touches them.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const HISTORY_LIMIT_DEFAULT = 50;
const HISTORY_LIMIT_MAX = 200;
const GATEWAY_OP_TIMEOUT_MS = 10_000;
const VOICE_POLL_INTERVAL_MS = 1_000;
const VOICE_POLL_MAX_ATTEMPTS = 30;
const execFileAsync = promisify(execFile);

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string | null;
  sessionKey: string;
}

export interface ChatHistoryResult {
  ok: boolean;
  available: boolean;
  sessionKey: string;
  messages: ChatMessage[];
  truncated: boolean;
  reason: string | null;
}

// Minimal socket interface — matches Node.js 22 global WebSocket and browser WebSocket.
export interface GatewaySocket {
  addEventListener(event: "open", handler: () => void): void;
  addEventListener(event: "message", handler: (e: { data: unknown }) => void): void;
  addEventListener(event: "error", handler: (e: { message?: string }) => void): void;
  send(data: string): void;
  close(): void;
}

export type WsFactory = (url: string) => GatewaySocket;
export type GatewayCall = (
  method: string,
  params: Record<string, unknown>,
  opts: { gatewayUrl: string; timeoutMs: number },
) => Promise<Record<string, unknown>>;

function defaultWsFactory(url: string): GatewaySocket {
  // Node.js 22 exposes WebSocket globally; cast through unknown for TypeScript.
  return new (globalThis as unknown as { WebSocket: new (u: string) => GatewaySocket }).WebSocket(url);
}

function parseJsonFromCliOutput(output: string): Record<string, unknown> {
  const trimmed = output.trim();
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] !== "{") continue;
    try {
      const parsed = JSON.parse(trimmed.slice(i)) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Keep scanning; OpenClaw may print warnings before the JSON payload.
    }
  }
  throw new Error("OpenClaw Gateway returned non-JSON response");
}

function extractOpenclawErrorMessage(data: Record<string, unknown>): string {
  const error = data.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "OpenClaw returned an error.";
}

function normalizeContent(raw: Record<string, unknown>): string {
  if (typeof raw.content === "string") return raw.content;
  if (Array.isArray(raw.content)) {
    return raw.content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const text = (part as Record<string, unknown>).text;
        return typeof text === "string" ? text : "";
      })
      .join("");
  }
  return typeof raw.text === "string" ? raw.text : "";
}

function normalizeTimestampValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const ms = value > 1_000_000_000_000 ? value : value * 1000;
  return new Date(ms).toISOString();
}

function isJsonPayload(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function isOpenClawToolOutput(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (isJsonPayload(trimmed)) return true;
  if (/^---\s*\nname:\s*[\w-]+/i.test(trimmed)) return true;
  if (/^(sed|grep|rg|curl|node|npm|python|tsx):\s.+/i.test(trimmed)) return true;
  return false;
}

function speakableAssistantContent(message: ChatMessage): string | null {
  const content = message.content.trim();
  if (isOpenClawToolOutput(content)) return null;
  return content;
}

async function defaultGatewayCall(
  method: string,
  params: Record<string, unknown>,
  opts: { gatewayUrl: string; timeoutMs: number },
): Promise<Record<string, unknown>> {
  // Let OpenClaw resolve local/remote gateway details from its own config.
  // Passing --url forces explicit credentials and bypasses trusted local device auth.
  void opts.gatewayUrl;
  const openclawBin = process.env.OPENCLAW_BIN?.trim() || "openclaw";
  const args = [
    "gateway",
    "call",
    method,
    "--params",
    JSON.stringify(params),
    "--json",
  ];

  try {
    const { stdout } = await execFileAsync(openclawBin, args, {
      timeout: opts.timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    });
    return parseJsonFromCliOutput(stdout);
  } catch (err) {
    const maybe = err as { stdout?: unknown; stderr?: unknown; message?: unknown };
    if (typeof maybe.stdout === "string" && maybe.stdout.trim()) {
      try {
        return parseJsonFromCliOutput(maybe.stdout);
      } catch {
        // Fall through to a concise process error.
      }
    }
    const stderr = typeof maybe.stderr === "string" ? maybe.stderr.trim().split("\n").find((line) => line.trim()) : "";
    const message = typeof maybe.message === "string" ? maybe.message : "OpenClaw Gateway CLI call failed";
    throw new Error(stderr || message);
  }
}

/**
 * Open a fresh WebSocket connection, send one request, wait for one reply, close.
 * Rejects on timeout, connection error, or non-JSON response.
 */
async function gatewayRequest(
  gatewayUrl: string,
  payload: Record<string, unknown>,
  opts: { timeoutMs?: number; _wsFactory?: WsFactory; _gatewayCall?: GatewayCall } = {},
): Promise<Record<string, unknown>> {
  const timeoutMs = opts.timeoutMs ?? GATEWAY_OP_TIMEOUT_MS;

  if (!opts._wsFactory) {
    const op = typeof payload.op === "string" ? payload.op : "";
    if (!op) throw new Error("OpenClaw Gateway method is missing.");
    const { op: _op, ...params } = payload;
    const data = await (opts._gatewayCall ?? defaultGatewayCall)(op, params, { gatewayUrl, timeoutMs });
    return typeof data.ok === "boolean" ? data : { ok: true, ...data };
  }

  const makeWs = opts._wsFactory ?? defaultWsFactory;

  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    let ws: GatewaySocket;
    try {
      ws = makeWs(gatewayUrl);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const timer = setTimeout(() => {
      settle(() => {
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error("OpenClaw Gateway request timed out"));
      });
    }, timeoutMs);

    ws.addEventListener("error", (e) => {
      settle(() => {
        reject(new Error(`OpenClaw Gateway WebSocket error: ${e.message ?? "connection failed"}`));
      });
    });

    ws.addEventListener("open", () => {
      try {
        ws.send(JSON.stringify(payload));
      } catch (err) {
        settle(() => {
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      }
    });

    ws.addEventListener("message", (e) => {
      settle(() => {
        try { ws.close(); } catch { /* ignore */ }
        try {
          const text = typeof e.data === "string" ? e.data : String(e.data);
          const data = JSON.parse(text) as Record<string, unknown>;
          resolve(data);
        } catch {
          reject(new Error("OpenClaw Gateway returned non-JSON response"));
        }
      });
    });
  });
}

/**
 * Normalise a raw Gateway message object into a display-ready ChatMessage.
 * Returns null for anything that cannot be coerced to a valid message.
 */
function normalizeMessage(raw: unknown, sessionKey: string): ChatMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;

  const content = normalizeContent(m);

  const rawRole = m.role ?? m.sender;
  const role: "user" | "assistant" | "system" =
    rawRole === "user" ? "user" :
    rawRole === "system" ? "system" :
    "assistant";

  const id = typeof m.id === "string" ? m.id :
    typeof m.messageId === "string" ? m.messageId :
    `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const timestamp =
    normalizeTimestampValue(m.timestamp) ??
    normalizeTimestampValue(m.createdAt) ??
    normalizeTimestampValue(m.ts);

  return { id, role, content, timestamp, sessionKey };
}

export interface ChatSendResult {
  ok: boolean;
  available: boolean;
  sessionKey: string;
  runId: string | null;
  reason: string | null;
}

export interface ChatInjectResult {
  ok: boolean;
  available: boolean;
  sessionKey: string;
  messageId: string | null;
  reason: string | null;
}

/**
 * Send a user message to the OpenClaw Gateway via chat.send.
 * Returns a structured unavailable result (not a thrown error) when the
 * Gateway is unreachable or OpenClaw is absent.
 */
export async function sendChatMessage(opts: {
  gatewayUrl: string;
  sessionKey?: string;
  message: string;
  idempotencyKey?: string;
  _wsFactory?: WsFactory;
  _gatewayCall?: GatewayCall;
  _timeoutMs?: number;
}): Promise<ChatSendResult> {
  const sessionKey = opts.sessionKey?.trim() || "agent:main:main";

  const payload: Record<string, unknown> = {
    op: "chat.send",
    sessionKey,
    message: opts.message,
  };
  if (opts.idempotencyKey) {
    payload.idempotencyKey = opts.idempotencyKey;
  }

  let data: Record<string, unknown>;
  try {
    data = await gatewayRequest(
      opts.gatewayUrl,
      payload,
      { timeoutMs: opts._timeoutMs, _wsFactory: opts._wsFactory, _gatewayCall: opts._gatewayCall },
    );
  } catch (err) {
    return {
      ok: false,
      available: false,
      sessionKey,
      runId: null,
      reason: err instanceof Error ? err.message : "OpenClaw Gateway is not reachable.",
    };
  }

  if (!data.ok) {
    return {
      ok: false,
      available: true,
      sessionKey,
      runId: null,
      reason: extractOpenclawErrorMessage(data),
    };
  }

  const runId = typeof data.runId === "string" ? data.runId : null;

  return {
    ok: true,
    available: true,
    sessionKey,
    runId,
    reason: null,
  };
}

/**
 * Inject a message directly into an OpenClaw session via chat.inject.
 * Unlike chat.send, inject does not trigger an assistant response.
 * Returns a structured unavailable result (not a thrown error) when the
 * Gateway is unreachable or OpenClaw is absent.
 */
export async function injectChatMessage(opts: {
  gatewayUrl: string;
  sessionKey?: string;
  text: string;
  role?: "user" | "assistant" | "system";
  idempotencyKey?: string;
  _wsFactory?: WsFactory;
  _gatewayCall?: GatewayCall;
  _timeoutMs?: number;
}): Promise<ChatInjectResult> {
  const sessionKey = opts.sessionKey?.trim() || "agent:main:main";

  const payload: Record<string, unknown> = {
    op: "chat.inject",
    sessionKey,
    text: opts.text,
  };
  if (opts.role) {
    payload.role = opts.role;
  }
  if (opts.idempotencyKey) {
    payload.idempotencyKey = opts.idempotencyKey;
  }

  let data: Record<string, unknown>;
  try {
    data = await gatewayRequest(
      opts.gatewayUrl,
      payload,
      { timeoutMs: opts._timeoutMs, _wsFactory: opts._wsFactory, _gatewayCall: opts._gatewayCall },
    );
  } catch (err) {
    return {
      ok: false,
      available: false,
      sessionKey,
      messageId: null,
      reason: err instanceof Error ? err.message : "OpenClaw Gateway is not reachable.",
    };
  }

  if (!data.ok) {
    return {
      ok: false,
      available: true,
      sessionKey,
      messageId: null,
      reason: extractOpenclawErrorMessage(data),
    };
  }

  const messageId = typeof data.messageId === "string" ? data.messageId : null;

  return {
    ok: true,
    available: true,
    sessionKey,
    messageId,
    reason: null,
  };
}

export interface PollAssistantReplyResult {
  found: boolean;
  text: string | null;
  reason: string | null;
}

/**
 * Poll chat history until an assistant message appears at or after sentAfter, or
 * maxAttempts × pollIntervalMs elapses. Designed for the voice return path:
 * send a message to Vale/OpenClaw, then watch for the assistant's answer.
 * Returns found:false with a reason on timeout or gateway failure.
 */
export async function pollForAssistantReply(opts: {
  gatewayUrl: string;
  sessionKey?: string;
  sentAfter: string;
  pollIntervalMs?: number;
  maxAttempts?: number;
  _wsFactory?: WsFactory;
  _gatewayCall?: GatewayCall;
  _timeoutMs?: number;
}): Promise<PollAssistantReplyResult> {
  const sessionKey = opts.sessionKey?.trim() || "agent:main:main";
  const intervalMs = opts.pollIntervalMs ?? VOICE_POLL_INTERVAL_MS;
  const maxAttempts = opts.maxAttempts ?? VOICE_POLL_MAX_ATTEMPTS;
  const sentTime = Date.parse(opts.sentAfter);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }

    const history = await fetchChatHistory({
      gatewayUrl: opts.gatewayUrl,
      sessionKey,
      limit: 20,
      _wsFactory: opts._wsFactory,
      _gatewayCall: opts._gatewayCall,
      _timeoutMs: opts._timeoutMs,
    });

    if (!history.ok && !history.available) {
      return { found: false, text: null, reason: history.reason ?? "OpenClaw Gateway is not reachable." };
    }

    // Find the earliest speakable assistant message at or after sentAfter.
    // OpenClaw can emit assistant-role scratch/tool records before the final
    // reply, and the voice path should not stop on those.
    const candidates = history.messages.filter((m) => {
      if (m.role !== "assistant") return false;
      if (!m.timestamp) return false;
      return Date.parse(m.timestamp) >= sentTime;
    });

    if (candidates.length > 0) {
      candidates.sort((a, b) => Date.parse(a.timestamp!) - Date.parse(b.timestamp!));
      for (const candidate of candidates) {
        const text = speakableAssistantContent(candidate);
        if (text) return { found: true, text, reason: null };
      }
    }
  }

  return { found: false, text: null, reason: "OpenClaw response timed out." };
}

/**
 * Fetch bounded, display-ready chat history from the OpenClaw Gateway.
 * Returns a structured unavailable result (not a thrown error) when the
 * Gateway is unreachable or OpenClaw is absent.
 */
export async function fetchChatHistory(opts: {
  gatewayUrl: string;
  sessionKey?: string;
  limit?: number;
  _wsFactory?: WsFactory;
  _gatewayCall?: GatewayCall;
  _timeoutMs?: number;
}): Promise<ChatHistoryResult> {
  const sessionKey = opts.sessionKey?.trim() || "agent:main:main";
  const rawLimit = opts.limit ?? HISTORY_LIMIT_DEFAULT;
  const limit = Math.min(Math.max(1, isNaN(rawLimit) ? HISTORY_LIMIT_DEFAULT : rawLimit), HISTORY_LIMIT_MAX);

  let data: Record<string, unknown>;
  try {
    data = await gatewayRequest(
      opts.gatewayUrl,
      { op: "chat.history", sessionKey, limit },
      { timeoutMs: opts._timeoutMs, _wsFactory: opts._wsFactory, _gatewayCall: opts._gatewayCall },
    );
  } catch (err) {
    return {
      ok: false,
      available: false,
      sessionKey,
      messages: [],
      truncated: false,
      reason: err instanceof Error ? err.message : "OpenClaw Gateway is not reachable.",
    };
  }

  if (!data.ok) {
    return {
      ok: false,
      available: true,
      sessionKey,
      messages: [],
      truncated: false,
      reason: extractOpenclawErrorMessage(data),
    };
  }

  const rawMessages = Array.isArray(data.messages) ? data.messages : [];
  // Truncate to cap rather than rejecting — bridge marks the result.
  const oversized = rawMessages.length > HISTORY_LIMIT_MAX;
  const sliced = oversized ? rawMessages.slice(-HISTORY_LIMIT_MAX) : rawMessages;
  const messages = sliced
    .map((m) => normalizeMessage(m, sessionKey))
    .filter((m): m is ChatMessage => m !== null);

  return {
    ok: true,
    available: true,
    sessionKey,
    messages,
    truncated: oversized,
    reason: null,
  };
}
