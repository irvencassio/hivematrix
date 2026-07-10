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

test("chatComplete throws: passthrough returns the raw prompt unchanged, agentType auto", async () => {
  const result = await enhancePrompt("fix the login bug", {
    chatComplete: async () => { throw new Error("local model unreachable"); },
  });
  assert.deepEqual(result, { enhanced: "fix the login bug", rationale: "", title: "", agentType: "auto" });
});

test("empty enhanced field falls back to passthrough, agentType auto", async () => {
  const result = await enhancePrompt("fix the login bug", {
    chatComplete: async () => JSON.stringify({ enhanced: "   ", rationale: "no-op" }),
  });
  assert.deepEqual(result, { enhanced: "fix the login bug", rationale: "", title: "", agentType: "auto" });
});

test("a valid core-roster agentType from the model is passed through as a suggestion", async () => {
  const result = await enhancePrompt("design the new pricing page", {
    chatComplete: async () => JSON.stringify({
      agentType: "designer", title: "Design pricing page", enhanced: "Design the pricing page layout.", rationale: "",
    }),
  });
  assert.equal(result.agentType, "designer");
});

test("missing agentType field falls back to auto, not undefined", async () => {
  const result = await enhancePrompt("fix the login bug", {
    chatComplete: async () => JSON.stringify({ enhanced: "Fix it.", rationale: "" }),
  });
  assert.equal(result.agentType, "auto");
});

test("a hallucinated agentType (not a real core-roster id) is rejected, never trusted verbatim", async () => {
  const result = await enhancePrompt("fix the login bug", {
    chatComplete: async () => JSON.stringify({ agentType: "made-up-role-xyz", enhanced: "Fix it.", rationale: "" }),
  });
  assert.equal(result.agentType, "auto");
});

test("a domain id from the model is rejected — the wizard must never suggest an explicit-only role", async () => {
  const trader = await enhancePrompt("analyze this stock", {
    chatComplete: async () => JSON.stringify({ agentType: "trader", enhanced: "Analyze the stock.", rationale: "" }),
  });
  assert.equal(trader.agentType, "auto", "trader is domain-tier — explicit pick only");
});

test("coo is a valid wizard suggestion (Spec 3 Phase 4 promoted it to core-tier)", async () => {
  const coo = await enhancePrompt("coordinate the launch across teams", {
    chatComplete: async () => JSON.stringify({ agentType: "coo", enhanced: "Coordinate the launch.", rationale: "" }),
  });
  assert.equal(coo.agentType, "coo");
});

test("the system prompt is role-neutral: no hard-coded 'coding-agent' framing or blanket file-path instruction", async () => {
  let capturedSystemPrompt = "";
  await enhancePrompt("write the launch blog post", {
    chatComplete: async (messages) => {
      capturedSystemPrompt = messages[0]?.content ?? "";
      return JSON.stringify({ agentType: "marketing", title: "Launch blog post", enhanced: "Write the launch blog post.", rationale: "" });
    },
  });
  assert.doesNotMatch(capturedSystemPrompt, /a coding-agent task queue/i);
  assert.doesNotMatch(capturedSystemPrompt, /that a coding agent can execute/i);
  assert.match(capturedSystemPrompt, /founder\/marketing\/general task/, "the prompt conditions structure on the suggested role");
});
