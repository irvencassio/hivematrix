import test from "node:test";
import assert from "node:assert/strict";
import { decompose, parseSteps } from "./decompose";
import type { ChatComplete } from "@/lib/models/chat-client";

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

test("decompose returns null when offline (deterministic fallback)", async () => {
  const out = await decompose(
    { description: "do stuff" },
    { client: fakeClient('["A","B"]'), connectivityMode: "offline" },
  );
  assert.equal(out, null);
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
