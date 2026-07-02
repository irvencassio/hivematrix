import test from "node:test";
import assert from "node:assert/strict";
import { isSecretSet, secretStatuses, resolveSecret, KNOWN_SECRETS } from "./secrets";
import type { VaultRef } from "@/lib/vault/refs";

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
  assert.equal(alpaca.source, "env");
  assert.equal(statuses.find((s) => s.env === "ANTHROPIC_API_KEY")!.set, false);
  // required fields always present
  assert.ok(Object.keys(alpaca).includes("env"));
  assert.ok(Object.keys(alpaca).includes("label"));
  assert.ok(Object.keys(alpaca).includes("purpose"));
  assert.ok(Object.keys(alpaca).includes("set"));
  assert.ok(Object.keys(alpaca).includes("source"));
  // no value leakage
  assert.ok(!JSON.stringify(statuses).includes("abc"));
});

test("secretStatuses reports vault source when env absent and vault index has the ref", () => {
  const env = {} as NodeJS.ProcessEnv;
  const vaultIndex = new Set<string>(["vault://env/APCA_API_KEY_ID"]);
  const statuses = secretStatuses(env, vaultIndex);
  const alpaca = statuses.find((s) => s.env === "APCA_API_KEY_ID")!;
  assert.equal(alpaca.set, true);
  assert.equal(alpaca.source, "vault");
});

test("secretStatuses reports unset when neither env nor vault has the key", () => {
  const env = {} as NodeJS.ProcessEnv;
  const vaultIndex = new Set<string>();
  const statuses = secretStatuses(env, vaultIndex);
  const alpaca = statuses.find((s) => s.env === "APCA_API_KEY_ID")!;
  assert.equal(alpaca.set, false);
  assert.equal(alpaca.source, null);
});

test("env takes precedence over vault", () => {
  const env = { APCA_API_KEY_ID: "env-value" } as NodeJS.ProcessEnv;
  const vaultIndex = new Set<string>(["vault://env/APCA_API_KEY_ID"]);
  const statuses = secretStatuses(env, vaultIndex);
  const alpaca = statuses.find((s) => s.env === "APCA_API_KEY_ID")!;
  assert.equal(alpaca.set, true);
  assert.equal(alpaca.source, "env");
});

// ── resolveSecret ──────────────────────────────────────────────────────────

test("resolveSecret returns env value when present", async () => {
  const env = { APCA_API_KEY_ID: "from-env" } as NodeJS.ProcessEnv;
  const result = await resolveSecret("APCA_API_KEY_ID", { env });
  assert.equal(result, "from-env");
});

test("resolveSecret trims whitespace from env value", async () => {
  const env = { APCA_API_KEY_ID: "  trimmed  " } as NodeJS.ProcessEnv;
  const result = await resolveSecret("APCA_API_KEY_ID", { env });
  assert.equal(result, "trimmed");
});

test("resolveSecret returns undefined when env absent and no vaultRef configured", async () => {
  const env = {} as NodeJS.ProcessEnv;
  // ANTHROPIC_API_KEY has no vaultRef in KNOWN_SECRETS
  const result = await resolveSecret("ANTHROPIC_API_KEY", { env });
  assert.equal(result, undefined);
});

test("resolveSecret returns undefined when env absent and no spec found", async () => {
  const env = {} as NodeJS.ProcessEnv;
  const result = await resolveSecret("UNKNOWN_KEY_XYZ", { env });
  assert.equal(result, undefined);
});

test("resolveSecret falls back to vault when env absent and vaultRef present", async () => {
  const env = {} as NodeJS.ProcessEnv;
  const resolveRef = async (ref: VaultRef) => {
    assert.equal(ref, "vault://env/APCA_API_KEY_ID");
    return "from-vault";
  };
  const result = await resolveSecret("APCA_API_KEY_ID", { env, resolveRef });
  assert.equal(result, "from-vault");
});

test("resolveSecret env takes precedence over vault resolver (vault not called)", async () => {
  const env = { APCA_API_KEY_ID: "env-wins" } as NodeJS.ProcessEnv;
  let vaultCalled = false;
  const resolveRef = async (_ref: VaultRef) => { vaultCalled = true; return "vault-value"; };
  const result = await resolveSecret("APCA_API_KEY_ID", { env, resolveRef });
  assert.equal(result, "env-wins");
  assert.equal(vaultCalled, false);
});

test("resolveSecret returns undefined when vault throws", async () => {
  const env = {} as NodeJS.ProcessEnv;
  const resolveRef = async (_ref: VaultRef): Promise<string> => { throw new Error("keychain unavailable"); };
  const result = await resolveSecret("APCA_API_KEY_ID", { env, resolveRef });
  assert.equal(result, undefined);
});

test("resolveSecret returns undefined when vault returns blank", async () => {
  const env = {} as NodeJS.ProcessEnv;
  const resolveRef = async (_ref: VaultRef) => "   ";
  const result = await resolveSecret("APCA_API_KEY_ID", { env, resolveRef });
  assert.equal(result, undefined);
});
