import test from "node:test";
import assert from "node:assert/strict";

import { CODEX_COMPUTER_USE_MODEL_ID } from "./catalog";
import { CODEX_COMPUTER_USE_PROJECT } from "./computer-use";
import {
  normalizeRetryProjectForModel,
  resolveTaskModelId,
  resolveTaskModelOption,
} from "./task-model";

test("normalizeRetryProjectForModel uses the next selected model", () => {
  assert.equal(
    normalizeRetryProjectForModel("frontend", "claude-sonnet-4-6", CODEX_COMPUTER_USE_MODEL_ID),
    CODEX_COMPUTER_USE_PROJECT,
  );
  assert.equal(
    normalizeRetryProjectForModel(CODEX_COMPUTER_USE_PROJECT, CODEX_COMPUTER_USE_MODEL_ID, "claude-sonnet-4-6"),
    CODEX_COMPUTER_USE_PROJECT,
  );
});

test("resolveTaskModelId maps UI model options to saved task model ids", () => {
  assert.equal(resolveTaskModelId("chatgpt", ""), "codex:gpt-5.4");
  assert.equal(resolveTaskModelId("nano-banana", ""), "gemini-3.1-flash-image-preview");
  assert.equal(resolveTaskModelId("local", "qwen2.5-coder"), "qwen2.5-coder");
  assert.equal(resolveTaskModelId(null, "qwen2.5-coder"), undefined);
});

test("resolveTaskModelOption maps saved task model ids back to UI model options", () => {
  assert.equal(resolveTaskModelOption("codex:gpt-5.4", ""), "chatgpt");
  assert.equal(resolveTaskModelOption("qwen2.5-coder", "qwen2.5-coder"), "local");
  assert.equal(resolveTaskModelOption("unknown-model", "qwen2.5-coder"), null);
});
