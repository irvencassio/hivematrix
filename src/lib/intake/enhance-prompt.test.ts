import { test } from "node:test";
import assert from "node:assert/strict";
import { enhancePrompt } from "./enhance-prompt";

test("happy path: valid JSON reply is parsed into enhanced + rationale", async () => {
  const result = await enhancePrompt("fix the login bug", {
    chatComplete: async () => JSON.stringify({ enhanced: "# Objective\nFix login bug.", rationale: "Added structure." }),
  });
  assert.equal(result.enhanced, "# Objective\nFix login bug.");
  assert.equal(result.rationale, "Added structure.");
});

test("<think> blocks are stripped before JSON parsing", async () => {
  const result = await enhancePrompt("fix the login bug", {
    chatComplete: async () => `<think>reasoning about the request</think>${JSON.stringify({ enhanced: "Fixed prompt.", rationale: "Clarified scope." })}`,
  });
  assert.equal(result.enhanced, "Fixed prompt.");
  assert.equal(result.rationale, "Clarified scope.");
});

test("non-JSON reply: whole cleaned text becomes enhanced, rationale empty", async () => {
  const result = await enhancePrompt("fix the login bug", {
    chatComplete: async () => "Just fix the login bug by checking the session token.",
  });
  assert.equal(result.enhanced, "Just fix the login bug by checking the session token.");
  assert.equal(result.rationale, "");
});

test("chatComplete throws: passthrough returns the raw prompt unchanged", async () => {
  const result = await enhancePrompt("fix the login bug", {
    chatComplete: async () => { throw new Error("local model unreachable"); },
  });
  assert.deepEqual(result, { enhanced: "fix the login bug", rationale: "" });
});

test("empty enhanced field falls back to passthrough", async () => {
  const result = await enhancePrompt("fix the login bug", {
    chatComplete: async () => JSON.stringify({ enhanced: "   ", rationale: "no-op" }),
  });
  assert.deepEqual(result, { enhanced: "fix the login bug", rationale: "" });
});
