import test from "node:test";
import assert from "node:assert/strict";

import { MODEL_OPTIONS, normalizeModelOption } from "./catalog";

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
