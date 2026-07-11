import test from "node:test";
import assert from "node:assert/strict";
import { voiceLlmEnv } from "./llm-env";

test("voiceLlmEnv returns only app-metadata keys (no local-model wiring)", () => {
  const env = voiceLlmEnv();
  assert.deepEqual(Object.keys(env).sort(), ["HIVE_APP_BUILD", "HIVE_APP_BUILD_DATE", "HIVE_APP_VERSION"]);
  assert.ok(env.HIVE_APP_VERSION.length > 0);
});
