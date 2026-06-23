import test from "node:test";
import assert from "node:assert/strict";
import { openAiBaseUrl, voiceLlmEnv } from "./llm-env";

test("openAiBaseUrl appends /v1 and is idempotent on versioned/trailing-slash urls", () => {
  assert.equal(openAiBaseUrl("http://localhost:8080"), "http://localhost:8080/v1");
  assert.equal(openAiBaseUrl("http://localhost:8080/"), "http://localhost:8080/v1");
  assert.equal(openAiBaseUrl("http://localhost:1234/v1"), "http://localhost:1234/v1");
  assert.equal(openAiBaseUrl("http://localhost:1234/v1/"), "http://localhost:1234/v1");
  assert.equal(openAiBaseUrl("  http://host:11434  "), "http://host:11434/v1");
});

test("voiceLlmEnv returns {} or a complete, well-formed overlay", () => {
  const env = voiceLlmEnv();
  const keys = Object.keys(env);
  if (keys.length === 0) return; // no local profile on this machine — valid
  assert.deepEqual(keys.sort(), ["HIVE_APP_BUILD", "HIVE_APP_BUILD_DATE", "HIVE_APP_VERSION", "HIVE_LLM_API_KEY", "HIVE_LLM_BASE_URL", "HIVE_LLM_MODEL"]);
  assert.match(env.HIVE_LLM_BASE_URL, /\/v\d+$/);
  assert.ok(env.HIVE_LLM_MODEL.length > 0);
  assert.equal(env.HIVE_LLM_API_KEY, "local");
});
