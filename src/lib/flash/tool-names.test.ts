import test from "node:test";
import assert from "node:assert/strict";

import { flashToolName, bareFlashToolName, isFlashTool, FLASH_MCP_SERVER_NAME } from "./tool-names";

test("flashToolName namespaces a bare name the way Claude does", () => {
  assert.equal(flashToolName("brain_search"), "mcp__flash__brain_search");
  assert.equal(FLASH_MCP_SERVER_NAME, "flash");
});

test("flashToolName is idempotent — namespacing twice must not double the prefix", () => {
  assert.equal(flashToolName(flashToolName("brain_search")), "mcp__flash__brain_search");
});

test("bareFlashToolName strips the namespace and is safe on an already-bare name", () => {
  assert.equal(bareFlashToolName("mcp__flash__escalate_to_task"), "escalate_to_task");
  assert.equal(bareFlashToolName("escalate_to_task"), "escalate_to_task");
});

test("isFlashTool matches whichever spelling the CLI happens to send", () => {
  assert.equal(isFlashTool("mcp__flash__escalate_to_task", "escalate_to_task"), true);
  assert.equal(isFlashTool("escalate_to_task", "escalate_to_task"), true);
  assert.equal(isFlashTool("mcp__flash__brain_search", "escalate_to_task"), false);
});

/**
 * The regression this file exists for.
 *
 * The capability doctrine in context.ts named tools in prose while
 * prepareFlashMcp offered them namespaced. Nothing joined the two, so the
 * prompt could tell the model to call `brain_search` while the schema only had
 * `mcp__flash__brain_search`. The model obeyed the prompt and the CLI answered
 * "No such tool available" — before any HiveMatrix code ran, so no fallback
 * could rescue it. Observed live 2026-07-19.
 *
 * Asserting on the doctrine text is the check that was missing: a bare tool
 * name in the prompt is by definition a name the model cannot call.
 */
test("regression: the capability doctrine never names a tool in its bare form", async () => {
  const { assembleSystemPrompt } = await import("./context");
  const prompt = await assembleSystemPrompt("hi", "", null);

  // Every tool the doctrine mentions. If the doctrine grows a new one, add it
  // here — an unlisted tool is exactly how this bug got in.
  const mentioned = [
    "reminder_create", "calendar_create", "goals_list", "daily_review",
    "goal_checkin", "goal_upsert", "brain_search", "brain_read",
    "desktop_action", "skill_run", "learn_skill", "escalate_to_task",
  ];

  for (const tool of mentioned) {
    // A bare mention is one not immediately preceded by the mcp__flash__ prefix.
    const bare = new RegExp(`(?<!mcp__${FLASH_MCP_SERVER_NAME}__)\\b${tool}\\b`);
    assert.ok(
      !bare.test(prompt),
      `capability doctrine names "${tool}" without the mcp__flash__ prefix — the model cannot call that name`,
    );
  }
});
