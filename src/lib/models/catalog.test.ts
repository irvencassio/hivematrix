import test from "node:test";
import assert from "node:assert/strict";

import { MODEL_OPTIONS, normalizeModelOption, claudeAliasId } from "./catalog";

test("removed openai api model options normalize to chatgpt", () => {
  assert.equal(normalizeModelOption("openai"), "chatgpt");
  assert.equal(normalizeModelOption("openai-api"), "chatgpt");
});

test("model catalog no longer exposes the openai api option", () => {
  assert.equal(MODEL_OPTIONS.some((model) => model.value === "chatgpt"), true);
  assert.equal(MODEL_OPTIONS.some((model) => model.label === "OpenAI API"), false);
});

test("model catalog exposes Nano Banana with nanai provider", () => {
  const model = MODEL_OPTIONS.find((entry) => entry.value === "nano-banana");
  assert.ok(model);
  assert.equal(model?.modelId, "gemini-3.1-flash-image-preview");
  assert.equal(model?.provider, "nanai");
});

test("claudeAliasId maps legacy pinned Claude full IDs to CLI aliases", () => {
  assert.equal(claudeAliasId("claude-opus-4-8"), "opus");
  assert.equal(claudeAliasId("claude-sonnet-4-6"), "sonnet");
  assert.equal(claudeAliasId("claude-haiku-4-5-20251001"), "haiku");
  // future resolved IDs stay on-family too
  assert.equal(claudeAliasId("claude-sonnet-5-0"), "sonnet");
});

test("claudeAliasId passes through aliases and non-Claude ids unchanged", () => {
  assert.equal(claudeAliasId("opus"), "opus");
  assert.equal(claudeAliasId("sonnet"), "sonnet");
  assert.equal(claudeAliasId("codex:gpt-5.5"), "codex:gpt-5.5");
  assert.equal(claudeAliasId("qwen3-coder-30b"), "qwen3-coder-30b");
  assert.equal(claudeAliasId(""), "");
});
