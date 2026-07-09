import { test } from "node:test";
import assert from "node:assert/strict";
import { enhancePrompt } from "./enhance-prompt";

test("happy path: valid JSON reply is parsed into enhanced + rationale + title", async () => {
  const result = await enhancePrompt("fix the login bug", {
    chatComplete: async () => JSON.stringify({ title: "Fix login redirect loop", enhanced: "# Objective\nFix login bug.", rationale: "Added structure." }),
  });
  assert.equal(result.enhanced, "# Objective\nFix login bug.");
  assert.equal(result.rationale, "Added structure.");
  assert.equal(result.title, "Fix login redirect loop");
});

test("title is cleaned: markdown stripped, first line only, capped to 60 chars", async () => {
  const result = await enhancePrompt("fix the login bug", {
    chatComplete: async () => JSON.stringify({
      title: "# **Fix** the `login` bug\nsecond line ignored",
      enhanced: "Fix it.",
      rationale: "",
    }),
  });
  assert.equal(result.title, "Fix the login bug");

  const long = await enhancePrompt("fix the login bug", {
    chatComplete: async () => JSON.stringify({
      title: "This is a deliberately extremely long task title that goes well past the sixty character budget",
      enhanced: "Fix it.",
      rationale: "",
    }),
  });
  assert.ok(long.title.length <= 61, "capped to ~60 chars plus an ellipsis"); // 60 + "…"
  assert.ok(long.title.endsWith("…"));
});

test("missing title field falls back to empty string, not undefined", async () => {
  const result = await enhancePrompt("fix the login bug", {
    chatComplete: async () => JSON.stringify({ enhanced: "Fix it.", rationale: "" }),
  });
  assert.equal(result.title, "");
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
  assert.deepEqual(result, { enhanced: "fix the login bug", rationale: "", title: "" });
});

test("empty enhanced field falls back to passthrough", async () => {
  const result = await enhancePrompt("fix the login bug", {
    chatComplete: async () => JSON.stringify({ enhanced: "   ", rationale: "no-op" }),
  });
  assert.deepEqual(result, { enhanced: "fix the login bug", rationale: "", title: "" });
});
