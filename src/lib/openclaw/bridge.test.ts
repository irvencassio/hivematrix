import test from "node:test";
import assert from "node:assert/strict";

import { fetchChatHistory, sendChatMessage, injectChatMessage, pollForAssistantReply, type GatewaySocket, type WsFactory } from "./bridge";

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

// ── pollForAssistantReply ────────────────────────────────────────────────────

/**
 * Mock factory that returns responses from a queue, one per WS connection.
 * Once the queue is exhausted, the last response is repeated.
 */
function makeMockWsFactoryQueue(responses: unknown[]): { factory: WsFactory } {
  let index = 0;

  const factory: WsFactory = (_url: string): GatewaySocket => {
    const response = responses[index] ?? responses[responses.length - 1];
    index++;

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
      send(_data: string) {
        Promise.resolve().then(() =>
          handlers.message.forEach(h => h({ data: JSON.stringify(response) }))
        );
      },
      close() {},
    };

    Promise.resolve().then(() => handlers.open.forEach(h => h()));
    return ws;
  };

  return { factory };
}

test("pollForAssistantReply: returns found:true with text on first poll", async () => {
  const sentAfter = "2026-06-30T10:00:00.000Z";
  const { factory } = makeMockWsFactoryQueue([{
    ok: true,
    messages: [
      { id: "u1", role: "user", content: "hey Vale", timestamp: "2026-06-30T10:00:01Z" },
      { id: "a1", role: "assistant", content: "Here is your email summary", timestamp: "2026-06-30T10:00:02Z" },
    ],
  }]);
  const result = await pollForAssistantReply({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    sentAfter,
    maxAttempts: 5,
    pollIntervalMs: 1,
    _wsFactory: factory,
    _timeoutMs: 100,
  });
  assert.equal(result.found, true);
  assert.equal(result.text, "Here is your email summary");
  assert.equal(result.reason, null);
});

test("pollForAssistantReply: finds assistant reply on second poll", async () => {
  const sentAfter = "2026-06-30T10:00:00.000Z";
  const { factory } = makeMockWsFactoryQueue([
    { ok: true, messages: [] },
    {
      ok: true,
      messages: [
        { id: "a1", role: "assistant", content: "Vale response arrived", timestamp: "2026-06-30T10:00:03Z" },
      ],
    },
  ]);
  const result = await pollForAssistantReply({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    sentAfter,
    maxAttempts: 5,
    pollIntervalMs: 1,
    _wsFactory: factory,
    _timeoutMs: 100,
  });
  assert.equal(result.found, true);
  assert.equal(result.text, "Vale response arrived");
});

test("pollForAssistantReply: returns found:false with timeout reason after maxAttempts exhausted", async () => {
  const sentAfter = "2026-06-30T10:00:00.000Z";
  const { factory } = makeMockWsFactoryQueue([{ ok: true, messages: [] }]);
  const result = await pollForAssistantReply({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    sentAfter,
    maxAttempts: 3,
    pollIntervalMs: 1,
    _wsFactory: factory,
    _timeoutMs: 100,
  });
  assert.equal(result.found, false);
  assert.equal(result.text, null);
  assert.equal(result.reason, "OpenClaw response timed out.");
});

test("pollForAssistantReply: ignores assistant messages before sentAfter", async () => {
  const sentAfter = "2026-06-30T10:00:10.000Z";
  const { factory } = makeMockWsFactoryQueue([{
    ok: true,
    messages: [
      { id: "a1", role: "assistant", content: "Stale message", timestamp: "2026-06-30T10:00:01Z" },
    ],
  }]);
  const result = await pollForAssistantReply({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    sentAfter,
    maxAttempts: 2,
    pollIntervalMs: 1,
    _wsFactory: factory,
    _timeoutMs: 100,
  });
  assert.equal(result.found, false);
  assert.equal(result.reason, "OpenClaw response timed out.");
});

test("pollForAssistantReply: ignores user and system messages", async () => {
  const sentAfter = "2026-06-30T10:00:00.000Z";
  const { factory } = makeMockWsFactoryQueue([{
    ok: true,
    messages: [
      { id: "u1", role: "user", content: "user msg", timestamp: "2026-06-30T10:00:02Z" },
      { id: "s1", role: "system", content: "system msg", timestamp: "2026-06-30T10:00:03Z" },
    ],
  }]);
  const result = await pollForAssistantReply({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    sentAfter,
    maxAttempts: 2,
    pollIntervalMs: 1,
    _wsFactory: factory,
    _timeoutMs: 100,
  });
  assert.equal(result.found, false);
  assert.equal(result.reason, "OpenClaw response timed out.");
});

test("pollForAssistantReply: returns earliest assistant message when multiple exist after sentAfter", async () => {
  const sentAfter = "2026-06-30T10:00:00.000Z";
  const { factory } = makeMockWsFactoryQueue([{
    ok: true,
    messages: [
      { id: "a2", role: "assistant", content: "Second reply", timestamp: "2026-06-30T10:00:05Z" },
      { id: "a1", role: "assistant", content: "First reply", timestamp: "2026-06-30T10:00:02Z" },
    ],
  }]);
  const result = await pollForAssistantReply({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    sentAfter,
    maxAttempts: 3,
    pollIntervalMs: 1,
    _wsFactory: factory,
    _timeoutMs: 100,
  });
  assert.equal(result.found, true);
  assert.equal(result.text, "First reply");
});

test("pollForAssistantReply: gateway connection error returns found:false with reason", async () => {
  const { factory } = makeMockWsFactory({ failOnConnect: true });
  const result = await pollForAssistantReply({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    sentAfter: "2026-06-30T10:00:00.000Z",
    maxAttempts: 3,
    pollIntervalMs: 1,
    _wsFactory: factory,
    _timeoutMs: 100,
  });
  assert.equal(result.found, false);
  assert.equal(result.text, null);
  assert.ok(typeof result.reason === "string" && result.reason.length > 0);
});

test("pollForAssistantReply: defaults sessionKey to agent:main:main when omitted", async () => {
  const { factory } = makeMockWsFactoryQueue([{
    ok: true,
    messages: [
      { id: "a1", role: "assistant", content: "Reply", timestamp: "2026-06-30T10:00:02Z" },
    ],
  }]);
  const result = await pollForAssistantReply({
    gatewayUrl: "ws://127.0.0.1:18789",
    sentAfter: "2026-06-30T10:00:00.000Z",
    maxAttempts: 3,
    pollIntervalMs: 1,
    _wsFactory: factory,
    _timeoutMs: 100,
  });
  assert.equal(result.found, true);
});

test("pollForAssistantReply: result JSON never contains token, secret, or password fields", async () => {
  const { factory } = makeMockWsFactory({ failOnConnect: true });
  const result = await pollForAssistantReply({
    gatewayUrl: "ws://127.0.0.1:18789",
    sentAfter: "2026-06-30T10:00:00.000Z",
    maxAttempts: 2,
    pollIntervalMs: 1,
    _wsFactory: factory,
    _timeoutMs: 100,
  });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.toLowerCase().includes("token"));
  assert.ok(!serialized.toLowerCase().includes("secret"));
  assert.ok(!serialized.toLowerCase().includes("password"));
});

// ── Send-then-poll integration ────────────────────────────────────────────────
// These tests exercise the full voice return path: sendChatMessage establishes
// a sentAt cursor; pollForAssistantReply uses it to find only the new reply.

test("send-then-poll integration: sessionKey from send flows into poll and finds the reply", async () => {
  const sentAt = "2026-07-01T10:00:00.000Z";
  const { factory: sendFactory } = makeMockWsFactory({ response: { ok: true, runId: "run-voice-123" } });

  const sendResult = await sendChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    message: "summarize today's email",
    _wsFactory: sendFactory,
  });

  assert.equal(sendResult.ok, true);
  assert.equal(sendResult.runId, "run-voice-123");
  assert.equal(sendResult.sessionKey, "agent:main:main");

  const { factory: pollFactory } = makeMockWsFactoryQueue([{
    ok: true,
    messages: [
      { id: "u1", role: "user", content: "summarize today's email", timestamp: "2026-07-01T10:00:01Z" },
      { id: "a1", role: "assistant", content: "You have 5 emails today.", timestamp: "2026-07-01T10:00:05Z" },
    ],
  }]);

  const pollResult = await pollForAssistantReply({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: sendResult.sessionKey,
    sentAfter: sentAt,
    maxAttempts: 3,
    pollIntervalMs: 1,
    _wsFactory: pollFactory,
    _timeoutMs: 100,
  });

  assert.equal(pollResult.found, true);
  assert.equal(pollResult.text, "You have 5 emails today.");
  assert.equal(pollResult.reason, null);
});

test("send-then-poll integration: failed send exposes ok:false and null runId — caller must not poll", async () => {
  const { factory } = makeMockWsFactory({ failOnConnect: true });

  const sendResult = await sendChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    message: "summarize today's email",
    _wsFactory: factory,
  });

  // Contract: ok:false + available:false means gateway is unreachable; do not proceed to poll.
  assert.equal(sendResult.ok, false);
  assert.equal(sendResult.available, false);
  assert.equal(sendResult.runId, null);
  // Neither gatewayUrl nor sentAt are present on a failed send — there is nothing to poll with.
  assert.ok(!("gatewayUrl" in sendResult), "gatewayUrl must not appear on a failed send result");
  assert.ok(!("sentAt" in sendResult), "sentAt must not appear on a failed send result");
});

test("send-then-poll integration: gateway error during poll returns found:false with reason", async () => {
  const sentAt = "2026-07-01T10:00:00.000Z";
  const { factory: sendFactory } = makeMockWsFactory({ response: { ok: true, runId: "run-poll-fail" } });
  const { factory: pollFactory } = makeMockWsFactory({ failOnConnect: true });

  const sendResult = await sendChatMessage({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    message: "summarize today's email",
    _wsFactory: sendFactory,
  });
  assert.equal(sendResult.ok, true);

  const pollResult = await pollForAssistantReply({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: sendResult.sessionKey,
    sentAfter: sentAt,
    maxAttempts: 3,
    pollIntervalMs: 1,
    _wsFactory: pollFactory,
    _timeoutMs: 100,
  });

  assert.equal(pollResult.found, false);
  assert.ok(typeof pollResult.reason === "string" && pollResult.reason.length > 0);
  assert.equal(pollResult.text, null);
});

test("send-then-poll integration: stale pre-sentAfter reply is filtered; only new reply after sentAt is returned", async () => {
  // Voice scenario: the session has history from earlier turns. sentAfter prevents
  // returning a stale reply that predates the current voice message send.
  const sentAt = "2026-07-01T10:05:00.000Z";

  const { factory: pollFactory } = makeMockWsFactoryQueue([{
    ok: true,
    messages: [
      { id: "stale", role: "assistant", content: "Old email summary from yesterday.", timestamp: "2026-07-01T09:00:00Z" },
      { id: "fresh", role: "assistant", content: "Today's email summary: 3 new messages.", timestamp: "2026-07-01T10:05:03Z" },
    ],
  }]);

  const pollResult = await pollForAssistantReply({
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    sentAfter: sentAt,
    maxAttempts: 3,
    pollIntervalMs: 1,
    _wsFactory: pollFactory,
    _timeoutMs: 100,
  });

  assert.equal(pollResult.found, true);
  assert.equal(pollResult.text, "Today's email summary: 3 new messages.", "stale pre-sentAfter reply must be excluded");
});
