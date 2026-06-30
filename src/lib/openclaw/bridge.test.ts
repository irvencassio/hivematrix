import test from "node:test";
import assert from "node:assert/strict";

import { fetchChatHistory, sendChatMessage, injectChatMessage, type GatewaySocket, type WsFactory } from "./bridge";

// ── Mock WebSocket factory helpers ──────────────────────────────────────────

interface MockWsOpts {
  /** If true, fire "error" instead of "open" */
  failOnConnect?: boolean;
  /** If true, fire "open" but never fire "message" (simulate silence) */
  silentAfterOpen?: boolean;
  /** Response to deliver as the first "message" event after send() */
  response?: unknown;
  /** Delay (ms) before delivering the response */
  delay?: number;
}

function makeMockWsFactory(opts: MockWsOpts = {}): { factory: WsFactory; sent: string[] } {
  const sent: string[] = [];

  const factory: WsFactory = (_url: string): GatewaySocket => {
    const handlers: {
      open: Array<() => void>;
      message: Array<(e: { data: unknown }) => void>;
      error: Array<(e: { message?: string }) => void>;
    } = { open: [], message: [], error: [] };

    const ws: GatewaySocket = {
      addEventListener(event, handler) {
        if (event === "open") handlers.open.push(handler as () => void);
        else if (event === "message") handlers.message.push(handler as (e: { data: unknown }) => void);
        else if (event === "error") handlers.error.push(handler as (e: { message?: string }) => void);
      },
      send(data: string) {
        sent.push(data);
        if (!opts.silentAfterOpen) {
          const reply = opts.response ?? { ok: true, messages: [] };
          const deliver = () => handlers.message.forEach(h => h({ data: JSON.stringify(reply) }));
          if (opts.delay && opts.delay > 0) setTimeout(deliver, opts.delay);
          else Promise.resolve().then(deliver);
        }
      },
      close() {},
    };

    // Trigger open or error on next tick
    if (opts.failOnConnect) {
      Promise.resolve().then(() =>
        handlers.error.forEach(h => h({ message: "connection refused" }))
      );
    } else {
      Promise.resolve().then(() => handlers.open.forEach(h => h()));
    }

    return ws;
  };

  return { factory, sent };
}

// ── fetchChatHistory ─────────────────────────────────────────────────────────

test("fetchChatHistory: connection error returns structured unavailable", async () => {
  const { factory } = makeMockWsFactory({ failOnConnect: true });
  const result = await fetchChatHistory({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    _wsFactory: factory,
  });
  assert.equal(result.ok, false);
  assert.equal(result.available, false);
  assert.deepEqual(result.messages, []);
  assert.equal(result.truncated, false);
  assert.ok(typeof result.reason === "string" && result.reason.length > 0);
});

test("fetchChatHistory: timeout returns structured unavailable", async () => {
  const { factory } = makeMockWsFactory({ silentAfterOpen: true });
  const result = await fetchChatHistory({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    _wsFactory: factory,
    _timeoutMs: 20,
  });
  assert.equal(result.ok, false);
  assert.equal(result.available, false);
  assert.ok(result.reason?.includes("timed out"));
});

test("fetchChatHistory: sends op=chat.history with sessionKey and limit", async () => {
  const { factory, sent } = makeMockWsFactory({ response: { ok: true, messages: [] } });
  await fetchChatHistory({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:custom",
    limit: 25,
    _wsFactory: factory,
  });
  assert.equal(sent.length, 1);
  const payload = JSON.parse(sent[0]) as Record<string, unknown>;
  assert.equal(payload.op, "chat.history");
  assert.equal(payload.sessionKey, "agent:main:custom");
  assert.equal(payload.limit, 25);
});

test("fetchChatHistory: returns display-ready messages from gateway response", async () => {
  const rawMessages = [
    { id: "m1", role: "user", content: "Hello OpenClaw", timestamp: "2026-06-30T10:00:00Z" },
    { id: "m2", role: "assistant", content: "Hello!", timestamp: "2026-06-30T10:00:01Z" },
  ];
  const { factory } = makeMockWsFactory({ response: { ok: true, messages: rawMessages } });
  const result = await fetchChatHistory({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    _wsFactory: factory,
  });
  assert.equal(result.ok, true);
  assert.equal(result.available, true);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].role, "user");
  assert.equal(result.messages[0].content, "Hello OpenClaw");
  assert.equal(result.messages[1].role, "assistant");
  assert.equal(result.truncated, false);
  assert.equal(result.reason, null);
});

test("fetchChatHistory: normalizes text field as fallback for content", async () => {
  const rawMessages = [{ id: "m1", role: "user", text: "text field fallback" }];
  const { factory } = makeMockWsFactory({ response: { ok: true, messages: rawMessages } });
  const result = await fetchChatHistory({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    _wsFactory: factory,
  });
  assert.equal(result.messages[0].content, "text field fallback");
});

test("fetchChatHistory: normalizes sender field as fallback for role", async () => {
  const rawMessages = [{ id: "m1", sender: "assistant", content: "hi" }];
  const { factory } = makeMockWsFactory({ response: { ok: true, messages: rawMessages } });
  const result = await fetchChatHistory({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    _wsFactory: factory,
  });
  assert.equal(result.messages[0].role, "assistant");
});

test("fetchChatHistory: normalizes numeric ts as ISO timestamp", async () => {
  const ts = 1751289600; // 2025-06-30T08:00:00Z
  const rawMessages = [{ id: "m1", role: "user", content: "hello", ts }];
  const { factory } = makeMockWsFactory({ response: { ok: true, messages: rawMessages } });
  const result = await fetchChatHistory({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    _wsFactory: factory,
  });
  assert.ok(result.messages[0].timestamp?.startsWith("20"));
});

test("fetchChatHistory: truncates oversized response and sets truncated:true", async () => {
  // Produce 201 messages (> HISTORY_LIMIT_MAX=200)
  const rawMessages = Array.from({ length: 201 }, (_, i) => ({
    id: `m${i}`,
    role: "assistant",
    content: `msg ${i}`,
  }));
  const { factory } = makeMockWsFactory({ response: { ok: true, messages: rawMessages } });
  const result = await fetchChatHistory({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    _wsFactory: factory,
  });
  assert.equal(result.messages.length, 200);
  assert.equal(result.truncated, true);
});

test("fetchChatHistory: clamps requested limit to HISTORY_LIMIT_MAX", async () => {
  const { factory, sent } = makeMockWsFactory({ response: { ok: true, messages: [] } });
  await fetchChatHistory({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    limit: 9999,
    _wsFactory: factory,
  });
  const payload = JSON.parse(sent[0]) as Record<string, unknown>;
  assert.ok((payload.limit as number) <= 200);
});

test("fetchChatHistory: attaches sessionKey to every message", async () => {
  const rawMessages = [{ id: "m1", role: "user", content: "hi" }];
  const { factory } = makeMockWsFactory({ response: { ok: true, messages: rawMessages } });
  const result = await fetchChatHistory({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:special",
    _wsFactory: factory,
  });
  assert.equal(result.messages[0].sessionKey, "agent:main:special");
});

test("fetchChatHistory: gateway ok:false returns structured error, available:true", async () => {
  const { factory } = makeMockWsFactory({ response: { ok: false, error: "session not found" } });
  const result = await fetchChatHistory({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    _wsFactory: factory,
  });
  assert.equal(result.ok, false);
  assert.equal(result.available, true);
  assert.equal(result.reason, "session not found");
  assert.deepEqual(result.messages, []);
});

test("fetchChatHistory: result JSON never contains token, secret, or password fields", async () => {
  const { factory } = makeMockWsFactory({ failOnConnect: true });
  const result = await fetchChatHistory({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    _wsFactory: factory,
  });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.toLowerCase().includes("token"));
  assert.ok(!serialized.toLowerCase().includes("secret"));
  assert.ok(!serialized.toLowerCase().includes("password"));
});

test("fetchChatHistory: defaults sessionKey to agent:main:main when omitted", async () => {
  const { factory, sent } = makeMockWsFactory({ response: { ok: true, messages: [] } });
  const result = await fetchChatHistory({
    gatewayUrl: "ws://127.0.0.1:18789",
    _wsFactory: factory,
  });
  assert.equal(result.sessionKey, "agent:main:main");
  const payload = JSON.parse(sent[0]) as Record<string, unknown>;
  assert.equal(payload.sessionKey, "agent:main:main");
});

// ── sendChatMessage ──────────────────────────────────────────────────────────

test("sendChatMessage: connection error returns structured unavailable", async () => {
  const { factory } = makeMockWsFactory({ failOnConnect: true });
  const result = await sendChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    message: "Hello",
    _wsFactory: factory,
  });
  assert.equal(result.ok, false);
  assert.equal(result.available, false);
  assert.equal(result.runId, null);
  assert.ok(typeof result.reason === "string" && result.reason.length > 0);
});

test("sendChatMessage: timeout returns structured unavailable", async () => {
  const { factory } = makeMockWsFactory({ silentAfterOpen: true });
  const result = await sendChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    message: "Hello",
    _wsFactory: factory,
    _timeoutMs: 20,
  });
  assert.equal(result.ok, false);
  assert.equal(result.available, false);
  assert.ok(result.reason?.includes("timed out"));
});

test("sendChatMessage: sends op=chat.send with sessionKey, message, and idempotencyKey", async () => {
  const { factory, sent } = makeMockWsFactory({ response: { ok: true, runId: "run-abc" } });
  await sendChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:custom",
    message: "What should I do next?",
    idempotencyKey: "idem-123",
    _wsFactory: factory,
  });
  assert.equal(sent.length, 1);
  const payload = JSON.parse(sent[0]) as Record<string, unknown>;
  assert.equal(payload.op, "chat.send");
  assert.equal(payload.sessionKey, "agent:main:custom");
  assert.equal(payload.message, "What should I do next?");
  assert.equal(payload.idempotencyKey, "idem-123");
});

test("sendChatMessage: omits idempotencyKey from payload when not provided", async () => {
  const { factory, sent } = makeMockWsFactory({ response: { ok: true, runId: "run-xyz" } });
  await sendChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    message: "Hello",
    _wsFactory: factory,
  });
  const payload = JSON.parse(sent[0]) as Record<string, unknown>;
  assert.ok(!("idempotencyKey" in payload));
});

test("sendChatMessage: returns ok:true with runId on success", async () => {
  const { factory } = makeMockWsFactory({ response: { ok: true, runId: "run-999" } });
  const result = await sendChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    message: "Hello",
    _wsFactory: factory,
  });
  assert.equal(result.ok, true);
  assert.equal(result.available, true);
  assert.equal(result.sessionKey, "agent:main:main");
  assert.equal(result.runId, "run-999");
  assert.equal(result.reason, null);
});

test("sendChatMessage: returns runId:null when gateway response omits runId", async () => {
  const { factory } = makeMockWsFactory({ response: { ok: true } });
  const result = await sendChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    message: "Hello",
    _wsFactory: factory,
  });
  assert.equal(result.ok, true);
  assert.equal(result.runId, null);
});

test("sendChatMessage: gateway ok:false returns structured error, available:true", async () => {
  const { factory } = makeMockWsFactory({ response: { ok: false, error: "session locked" } });
  const result = await sendChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    message: "Hello",
    _wsFactory: factory,
  });
  assert.equal(result.ok, false);
  assert.equal(result.available, true);
  assert.equal(result.runId, null);
  assert.equal(result.reason, "session locked");
});

test("sendChatMessage: defaults sessionKey to agent:main:main when omitted", async () => {
  const { factory, sent } = makeMockWsFactory({ response: { ok: true, runId: "r1" } });
  const result = await sendChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    message: "Hello",
    _wsFactory: factory,
  });
  assert.equal(result.sessionKey, "agent:main:main");
  const payload = JSON.parse(sent[0]) as Record<string, unknown>;
  assert.equal(payload.sessionKey, "agent:main:main");
});

test("sendChatMessage: result JSON never contains token, secret, or password fields", async () => {
  const { factory } = makeMockWsFactory({ failOnConnect: true });
  const result = await sendChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    message: "Hello",
    _wsFactory: factory,
  });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.toLowerCase().includes("token"));
  assert.ok(!serialized.toLowerCase().includes("secret"));
  assert.ok(!serialized.toLowerCase().includes("password"));
});

// ── injectChatMessage ────────────────────────────────────────────────────────

test("injectChatMessage: connection error returns structured unavailable", async () => {
  const { factory } = makeMockWsFactory({ failOnConnect: true });
  const result = await injectChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    text: "Context for the session",
    _wsFactory: factory,
  });
  assert.equal(result.ok, false);
  assert.equal(result.available, false);
  assert.equal(result.messageId, null);
  assert.ok(typeof result.reason === "string" && result.reason.length > 0);
});

test("injectChatMessage: timeout returns structured unavailable", async () => {
  const { factory } = makeMockWsFactory({ silentAfterOpen: true });
  const result = await injectChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    text: "Context for the session",
    _wsFactory: factory,
    _timeoutMs: 20,
  });
  assert.equal(result.ok, false);
  assert.equal(result.available, false);
  assert.ok(result.reason?.includes("timed out"));
});

test("injectChatMessage: sends op=chat.inject with sessionKey and text", async () => {
  const { factory, sent } = makeMockWsFactory({ response: { ok: true, messageId: "inj-abc" } });
  await injectChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:custom",
    text: "Injected context",
    _wsFactory: factory,
  });
  assert.equal(sent.length, 1);
  const payload = JSON.parse(sent[0]) as Record<string, unknown>;
  assert.equal(payload.op, "chat.inject");
  assert.equal(payload.sessionKey, "agent:main:custom");
  assert.equal(payload.text, "Injected context");
});

test("injectChatMessage: includes role in payload when provided", async () => {
  const { factory, sent } = makeMockWsFactory({ response: { ok: true, messageId: "inj-def" } });
  await injectChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    text: "System context",
    role: "system",
    _wsFactory: factory,
  });
  const payload = JSON.parse(sent[0]) as Record<string, unknown>;
  assert.equal(payload.role, "system");
});

test("injectChatMessage: omits role from payload when not provided", async () => {
  const { factory, sent } = makeMockWsFactory({ response: { ok: true, messageId: "inj-ghi" } });
  await injectChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    text: "Context without role",
    _wsFactory: factory,
  });
  const payload = JSON.parse(sent[0]) as Record<string, unknown>;
  assert.ok(!("role" in payload));
});

test("injectChatMessage: includes idempotencyKey in payload when provided", async () => {
  const { factory, sent } = makeMockWsFactory({ response: { ok: true, messageId: "inj-jkl" } });
  await injectChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    text: "Idempotent injection",
    idempotencyKey: "idem-xyz",
    _wsFactory: factory,
  });
  const payload = JSON.parse(sent[0]) as Record<string, unknown>;
  assert.equal(payload.idempotencyKey, "idem-xyz");
});

test("injectChatMessage: omits idempotencyKey from payload when not provided", async () => {
  const { factory, sent } = makeMockWsFactory({ response: { ok: true, messageId: "inj-mno" } });
  await injectChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    text: "No idem key",
    _wsFactory: factory,
  });
  const payload = JSON.parse(sent[0]) as Record<string, unknown>;
  assert.ok(!("idempotencyKey" in payload));
});

test("injectChatMessage: returns ok:true with messageId on success", async () => {
  const { factory } = makeMockWsFactory({ response: { ok: true, messageId: "inj-pqr" } });
  const result = await injectChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    text: "Hello",
    _wsFactory: factory,
  });
  assert.equal(result.ok, true);
  assert.equal(result.available, true);
  assert.equal(result.sessionKey, "agent:main:main");
  assert.equal(result.messageId, "inj-pqr");
  assert.equal(result.reason, null);
});

test("injectChatMessage: returns messageId:null when gateway response omits messageId", async () => {
  const { factory } = makeMockWsFactory({ response: { ok: true } });
  const result = await injectChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    text: "Hello",
    _wsFactory: factory,
  });
  assert.equal(result.ok, true);
  assert.equal(result.messageId, null);
});

test("injectChatMessage: gateway ok:false returns structured error, available:true", async () => {
  const { factory } = makeMockWsFactory({ response: { ok: false, error: "session read-only" } });
  const result = await injectChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    text: "Hello",
    _wsFactory: factory,
  });
  assert.equal(result.ok, false);
  assert.equal(result.available, true);
  assert.equal(result.messageId, null);
  assert.equal(result.reason, "session read-only");
});

test("injectChatMessage: defaults sessionKey to agent:main:main when omitted", async () => {
  const { factory, sent } = makeMockWsFactory({ response: { ok: true, messageId: "inj-stu" } });
  const result = await injectChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    text: "Hello",
    _wsFactory: factory,
  });
  assert.equal(result.sessionKey, "agent:main:main");
  const payload = JSON.parse(sent[0]) as Record<string, unknown>;
  assert.equal(payload.sessionKey, "agent:main:main");
});

test("injectChatMessage: result JSON never contains token, secret, or password fields", async () => {
  const { factory } = makeMockWsFactory({ failOnConnect: true });
  const result = await injectChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    text: "Hello",
    _wsFactory: factory,
  });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.toLowerCase().includes("token"));
  assert.ok(!serialized.toLowerCase().includes("secret"));
  assert.ok(!serialized.toLowerCase().includes("password"));
});
