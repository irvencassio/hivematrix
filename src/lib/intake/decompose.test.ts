import test from "node:test";
import assert from "node:assert/strict";
import { decompose, parseSteps, DECOMPOSE_MAX_TOKENS, DECOMPOSE_MAX_TOKENS_THINKING } from "./decompose";
import type { ChatComplete, ChatMessage } from "@/lib/models/chat-client";

function fakeClient(reply: string): ChatComplete {
  return async () => reply;
}

test("parseSteps pulls a JSON array, strips <think>, trims and dedupes", () => {
  const raw = '<think>let me think</think>\nHere you go:\n["Fix lint", "Fix lint", "  Update deps  ", ""]';
  assert.deepEqual(parseSteps(raw), ["Fix lint", "Update deps"]);
});

test("parseSteps falls back to numbered/bulleted lines when there is no JSON", () => {
  const raw = "1. First thing\n2. Second thing\n- Third thing";
  assert.deepEqual(parseSteps(raw), ["First thing", "Second thing", "Third thing"]);
});

test("decompose returns fragments from the resolved client", async () => {
  const out = await decompose(
    { description: "do a lot of stuff" },
    { client: fakeClient('["Step A", "Step B", "Step C"]'), connectivityMode: "cloud-ok" },
  );
  assert.deepEqual(out, ["Step A", "Step B", "Step C"]);
});

test("decompose returns null when offline with no local model (deterministic fallback)", async () => {
  const out = await decompose(
    { description: "do stuff" },
    { client: fakeClient('["A","B"]'), connectivityMode: "offline", localModelAvailable: false },
  );
  assert.equal(out, null);
});

test("decompose uses a local loopback model even when offline", async () => {
  const out = await decompose(
    { description: "do stuff" },
    { client: fakeClient('["A","B"]'), connectivityMode: "offline", localModelAvailable: true },
  );
  assert.deepEqual(out, ["A", "B"]);
});

test("decompose feeds the goal + success criteria to the model when goalFlight is set", async () => {
  let capturedUser = "";
  const client: ChatComplete = async (messages: ChatMessage[]) => {
    capturedUser = messages.find((m) => m.role === "user")?.content ?? "";
    return '["Scaffold the store", "Add the cart", "Wire Stripe checkout"]';
  };
  const out = await decompose(
    { description: "Build a store with a cart and Stripe checkout" },
    {
      client,
      connectivityMode: "cloud-ok",
      goalFlight: { goal: "Build a store", successCriteria: ["a cart", "Stripe checkout"] },
    },
  );
  assert.deepEqual(out, ["Scaffold the store", "Add the cart", "Wire Stripe checkout"]);
  const user = capturedUser;
  assert.match(user, /Goal: Build a store/);
  assert.match(user, /a cart/);
  assert.match(user, /Stripe checkout/);
});

test("decompose sizes the token budget up for a reasoning (thinking) model", async () => {
  let seenMaxTokens = 0;
  const client: ChatComplete = async (_messages, opts) => {
    seenMaxTokens = opts?.maxTokens ?? 0;
    return '["A","B"]';
  };
  await decompose(
    { description: "do stuff" },
    { client, connectivityMode: "cloud-ok", thinkingEnabled: true },
  );
  assert.equal(seenMaxTokens, DECOMPOSE_MAX_TOKENS_THINKING);

  await decompose(
    { description: "do stuff" },
    { client, connectivityMode: "cloud-ok", thinkingEnabled: false },
  );
  assert.equal(seenMaxTokens, DECOMPOSE_MAX_TOKENS);
});

test("decompose returns null when no client is configured", async () => {
  const out = await decompose({ description: "do stuff" }, { client: null, connectivityMode: "local-only" });
  assert.equal(out, null);
});

test("decompose returns null on malformed model output", async () => {
  const out = await decompose({ description: "x" }, { client: fakeClient("not json, no list at all"), connectivityMode: "local-only" });
  assert.equal(out, null);
});

test("decompose returns null when the model yields fewer than two steps", async () => {
  const out = await decompose({ description: "x" }, { client: fakeClient('["only one"]'), connectivityMode: "local-only" });
  assert.equal(out, null);
});

test("decompose caps at MAX_STEPS", async () => {
  const many = JSON.stringify(Array.from({ length: 30 }, (_, i) => "step " + i));
  const out = await decompose({ description: "x" }, { client: fakeClient(many), connectivityMode: "cloud-ok" });
  assert.ok(out);
  assert.ok(out!.length <= 12);
});

test("decompose returns null when the client throws (caller falls back)", async () => {
  const throwing: ChatComplete = async () => { throw new Error("model down"); };
  const out = await decompose({ description: "x" }, { client: throwing, connectivityMode: "cloud-ok" });
  assert.equal(out, null);
});
