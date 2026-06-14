import test from "node:test";
import assert from "node:assert/strict";
import { isSecretSet, secretStatuses, KNOWN_SECRETS } from "./secrets";

test("isSecretSet treats present+nonblank as set, blank/absent as unset", () => {
  const env = { A: "value", B: "  ", C: "" } as NodeJS.ProcessEnv;
  assert.equal(isSecretSet("A", env), true);
  assert.equal(isSecretSet("B", env), false);
  assert.equal(isSecretSet("C", env), false);
  assert.equal(isSecretSet("MISSING", env), false);
});

test("secretStatuses reports set/unset per known key and NEVER includes the value", () => {
  const env = { APCA_API_KEY_ID: "abc", ANTHROPIC_API_KEY: "" } as NodeJS.ProcessEnv;
  const statuses = secretStatuses(env);
  assert.equal(statuses.length, KNOWN_SECRETS.length);
  const alpaca = statuses.find((s) => s.env === "APCA_API_KEY_ID")!;
  assert.equal(alpaca.set, true);
  assert.equal(statuses.find((s) => s.env === "ANTHROPIC_API_KEY")!.set, false);
  // no value leakage — only env name, label, purpose, set
  assert.deepEqual(Object.keys(alpaca).sort(), ["env", "label", "purpose", "set"]);
  assert.ok(!JSON.stringify(statuses).includes("abc"));
});
