/**
 * OpenClaw bridge — narrow proxy for Gateway WebSocket operations.
 * Keeps OpenClaw credentials server-side; browser code never touches them.
 */

const HISTORY_LIMIT_DEFAULT = 50;
const HISTORY_LIMIT_MAX = 200;
const GATEWAY_OP_TIMEOUT_MS = 10_000;

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

function defaultWsFactory(url: string): GatewaySocket {
  // Node.js 22 exposes WebSocket globally; cast through unknown for TypeScript.
  return new (globalThis as unknown as { WebSocket: new (u: string) => GatewaySocket }).WebSocket(url);
}

/**
 * Open a fresh WebSocket connection, send one request, wait for one reply, close.
 * Rejects on timeout, connection error, or non-JSON response.
 */
async function gatewayRequest(
  gatewayUrl: string,
  payload: Record<string, unknown>,
  opts: { timeoutMs?: number; _wsFactory?: WsFactory } = {},
): Promise<Record<string, unknown>> {
  const timeoutMs = opts.timeoutMs ?? GATEWAY_OP_TIMEOUT_MS;
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

  const content = typeof m.content === "string" ? m.content :
    typeof m.text === "string" ? m.text : "";

  const rawRole = m.role ?? m.sender;
  const role: "user" | "assistant" | "system" =
    rawRole === "user" ? "user" :
    rawRole === "system" ? "system" :
    "assistant";

  const id = typeof m.id === "string" ? m.id :
    typeof m.messageId === "string" ? m.messageId :
    `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const timestamp =
    typeof m.timestamp === "string" ? m.timestamp :
    typeof m.createdAt === "string" ? m.createdAt :
    typeof m.ts === "number" ? new Date(m.ts * 1000).toISOString() :
    null;

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
      { timeoutMs: opts._timeoutMs, _wsFactory: opts._wsFactory },
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
      reason: typeof data.error === "string" ? data.error : "OpenClaw returned an error.",
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
      { timeoutMs: opts._timeoutMs, _wsFactory: opts._wsFactory },
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
      reason: typeof data.error === "string" ? data.error : "OpenClaw returned an error.",
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
      { timeoutMs: opts._timeoutMs, _wsFactory: opts._wsFactory },
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
      reason: typeof data.error === "string" ? data.error : "OpenClaw returned an error.",
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
