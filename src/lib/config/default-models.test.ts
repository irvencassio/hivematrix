import test from "node:test";
import assert from "node:assert/strict";

import {
  getDefaultModelForProfile,
  normalizeProfileKey,
  setDefaultModelForProfile,
} from "./default-models";

test("normalizeProfileKey preserves claude config dirs and expands bare profile names", () => {
  assert.equal(normalizeProfileKey(".claude-irv"), ".claude-irv");
  assert.equal(normalizeProfileKey("el"), ".claude-el");
  assert.equal(normalizeProfileKey(""), ".claude");
});

test("getDefaultModelForProfile prefers the profile-specific default model", () => {
  const config = {
    defaultModel: "sonnet",
    defaultModelByProfile: {
      ".claude-irv": "opus",
      ".claude-el": "haiku",
    },
  };

  assert.equal(getDefaultModelForProfile(config, ".claude-irv"), "opus");
  assert.equal(getDefaultModelForProfile(config, ".claude-el"), "haiku");
});

test("getDefaultModelForProfile falls back to the legacy global default", () => {
  assert.equal(
    getDefaultModelForProfile({ defaultModel: "chatgpt" }, ".claude-irv"),
    "chatgpt",
  );
  assert.equal(getDefaultModelForProfile({}, ".claude-irv"), "sonnet");
});

test("getDefaultModelForProfile migrates removed openai api defaults to chatgpt", () => {
  assert.equal(
    getDefaultModelForProfile({ defaultModel: "openai-api" }, ".claude-irv"),
    "chatgpt",
  );
  assert.equal(
    getDefaultModelForProfile({ defaultModelByProfile: { ".claude-irv": "openai" } }, ".claude-irv"),
    "chatgpt",
  );
});

test("setDefaultModelForProfile writes normalized profile keys without mutating unrelated entries", () => {
  const config = {
    defaultModel: "sonnet",
    defaultModelByProfile: {
      ".claude-el": "haiku",
    },
  };

  setDefaultModelForProfile(config, "irv", "opus");

  assert.deepEqual(config.defaultModelByProfile, {
    ".claude-el": "haiku",
    ".claude-irv": "opus",
  });
});
