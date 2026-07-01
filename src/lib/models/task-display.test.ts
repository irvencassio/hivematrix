import test from "node:test";
import assert from "node:assert/strict";

import { getEffectiveTaskModelId, getTaskModelShortName } from "./task-display";

test("getEffectiveTaskModelId prefers the runtime model when the saved model is missing", () => {
  assert.equal(
    getEffectiveTaskModelId({
      model: null,
      output: { modelsUsed: ["claude-sonnet-4-6"] },
    }),
    "claude-sonnet-4-6",
  );
});

test("getEffectiveTaskModelId falls back to the saved task model", () => {
  assert.equal(
    getEffectiveTaskModelId({
      model: "codex:gpt-5.4",
      output: { modelsUsed: [] },
    }),
    "codex:gpt-5.4",
  );
});

test("getTaskModelShortName maps the configured local model to Local", () => {
  assert.equal(
    getTaskModelShortName("qwen3.6-27b-instruct", "qwen3.6-27b-instruct"),
    "Local",
  );
});

test("getTaskModelShortName keeps known labels for cloud models", () => {
  assert.equal(getTaskModelShortName("codex:gpt-5.4", ""), "ChatGPT");
  assert.equal(getTaskModelShortName("claude-sonnet-4-6", ""), "Sonnet");
});

test("getTaskModelShortName resolves the Claude family by prefix and alias", () => {
  // The CLI reports the resolved full id in its stream; any future version must
  // still display as the family name, not an ugly suffix.
  assert.equal(getTaskModelShortName("claude-sonnet-5-0", ""), "Sonnet");
  assert.equal(getTaskModelShortName("claude-opus-4-8", ""), "Opus");
  // Bare aliases (what a task now carries) map to the family name too.
  assert.equal(getTaskModelShortName("sonnet", ""), "Sonnet");
  assert.equal(getTaskModelShortName("opus", ""), "Opus");
  assert.equal(getTaskModelShortName("haiku", ""), "Haiku");
});
