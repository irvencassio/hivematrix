import test from "node:test";
import assert from "node:assert/strict";
import { localChatComplete } from "./chat-client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("localChatComplete posts to the endpoint and returns the assistant content", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(String(url));
    return jsonResponse(200, { choices: [{ message: { role: "assistant", content: "hello from qwen" } }] });
  }) as unknown as typeof fetch;

  const out = await localChatComplete(
    [{ role: "user", content: "hi" }],
    { endpoint: "http://localhost:8080", model: "Qwen-Test", fetchImpl },
  );
  assert.equal(out, "hello from qwen");
  assert.match(calls[0], /\/chat\/completions$/);
});

test("localChatComplete falls through to /v1/chat/completions on a 404", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(String(url));
    if (String(url).includes("/v1/")) return jsonResponse(200, { choices: [{ message: { content: "second try" } }] });
    return jsonResponse(404, { error: "not found" });
  }) as unknown as typeof fetch;

  const out = await localChatComplete([{ role: "user", content: "hi" }], { endpoint: "http://localhost:8080", model: "m", fetchImpl });
  assert.equal(out, "second try");
  assert.equal(calls.length, 2);
  assert.match(calls[1], /\/v1\/chat\/completions$/);
});

test("localChatComplete throws on a non-2xx that has no fallback", async () => {
  const fetchImpl = (async () => jsonResponse(500, { error: "boom" })) as unknown as typeof fetch;
  await assert.rejects(
    () => localChatComplete([{ role: "user", content: "x" }], { endpoint: "http://localhost:8080/v1", model: "m", fetchImpl }),
    /50|failed|local/i,
  );
});
