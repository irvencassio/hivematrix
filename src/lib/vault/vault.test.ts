import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { isVaultRef, makeRef, parseRef, describeRef } from "./refs";
import type { VaultRef } from "./refs";
import { VaultKeychain } from "./keychain";
import { VaultStore } from "./store";

// ── ref helpers ────────────────────────────────────────────────────────────

test("makeRef produces a vault:// URI", () => {
  assert.equal(makeRef("site", "github.com"), "vault://site/github.com");
  assert.equal(makeRef("host", "build-server-ssh"), "vault://host/build-server-ssh");
});

test("isVaultRef accepts valid refs and rejects anything else", () => {
  assert.equal(isVaultRef("vault://site/github.com"), true);
  assert.equal(isVaultRef("vault://env/X_API_KEY"), true);
  assert.equal(isVaultRef("vault://"), false);
  assert.equal(isVaultRef("vault://site/"), false);
  assert.equal(isVaultRef("vault:///name"), false);
  assert.equal(isVaultRef("VAULT://site/name"), false);
  assert.equal(isVaultRef("not-a-ref"), false);
  assert.equal(isVaultRef(null), false);
  assert.equal(isVaultRef(42), false);
});

test("parseRef round-trips scope and name", () => {
  const { scope, name } = parseRef("vault://site/github.com");
  assert.equal(scope, "site");
  assert.equal(name, "github.com");
});

test("parseRef throws on invalid ref", () => {
  assert.throws(() => parseRef("not-a-ref"), /Invalid vault ref/);
  assert.throws(() => parseRef("vault://"), /Invalid vault ref/);
});

test("describeRef returns scope/name without the scheme", () => {
  assert.equal(describeRef("vault://site/github.com" as VaultRef), "site/github.com");
});

// ── VaultKeychain (mock runner) ────────────────────────────────────────────

function makeStore(): { store: VaultKeychain; calls: Array<{ file: string; args: string[]; stdin?: string }>; store_map: Map<string, string> } {
  const store_map = new Map<string, string>();
  const calls: Array<{ file: string; args: string[]; stdin?: string }> = [];

  const runner = async (file: string, args: string[], opts?: { stdin?: string }): Promise<{ stdout: string; stderr: string }> => {
    calls.push({ file, args, stdin: opts?.stdin });
    const cmd = args[0];
    const sIdx = args.indexOf("-s") + 1;
    const aIdx = args.indexOf("-a") + 1;
    const key = `${args[sIdx]}:${args[aIdx]}`;

    if (cmd === "add-generic-password") {
      if (opts?.stdin == null) throw new Error("no stdin for add-generic-password");
      store_map.set(key, opts.stdin.replace(/\n$/, ""));
      return { stdout: "", stderr: "" };
    }
    if (cmd === "find-generic-password") {
      const val = store_map.get(key);
      if (val == null) {
        const err = new Error(`SecKeychainSearchCopyNext: The specified item could not be found in the keychain.`);
        Object.assign(err, { code: 44 });
        throw err;
      }
      return { stdout: `${val}\n`, stderr: "" };
    }
    if (cmd === "delete-generic-password") {
      const deleted = store_map.delete(key);
      if (!deleted) {
        const err = new Error(`SecKeychainItemDelete: The specified item could not be found in the keychain.`);
        Object.assign(err, { code: 44 });
        throw err;
      }
      return { stdout: "", stderr: "" };
    }
    throw new Error(`Unknown security subcommand: ${cmd}`);
  };

  const store = new VaultKeychain({ run: runner });
  return { store, calls, store_map };
}

test("VaultKeychain.setSecret stores and getSecret retrieves the value", async () => {
  const { store } = makeStore();
  await store.setSecret("site", "github.com", "s3cr3t");
  const val = await store.getSecret("site", "github.com");
  assert.equal(val, "s3cr3t");
});

test("VaultKeychain.setSecret uses the hivematrix-vault service name", async () => {
  const { store, calls } = makeStore();
  await store.setSecret("env", "X_API_KEY", "abc");
  const addCall = calls.find((c) => c.args[0] === "add-generic-password")!;
  assert.equal(addCall.args[addCall.args.indexOf("-s") + 1], "hivematrix-vault");
  assert.equal(addCall.args[addCall.args.indexOf("-a") + 1], "env/X_API_KEY");
});

test("VaultKeychain.deleteSecret removes the value", async () => {
  const { store } = makeStore();
  await store.setSecret("host", "build-server", "pw123");
  await store.deleteSecret("host", "build-server");
  await assert.rejects(() => store.getSecret("host", "build-server"));
});

test("VaultKeychain rejects invalid scope/name characters", async () => {
  const { store } = makeStore();
  await assert.rejects(() => store.setSecret("UPPERCASE", "name", "v"), /scope/);
  await assert.rejects(() => store.setSecret("scope", "has space", "v"), /name/);
  await assert.rejects(() => store.setSecret("scope", "has/slash", "v"), /name/);
});

// ── VaultStore (mock runner + temp SQLite) ─────────────────────────────────

async function makeVaultStore(): Promise<VaultStore> {
  const tmpDb = join(tmpdir(), `vault-test-${randomUUID()}.db`);
  process.env.HIVEMATRIX_DB_PATH = tmpDb;

  // Reset the singleton so the new test DB is used
  const g = globalThis as unknown as { __hivematrixSqlite?: unknown };
  delete g.__hivematrixSqlite;

  // Run migrations to create vault_refs table
  const { getDb } = await import("@/lib/db");
  getDb();

  const secrets = new Map<string, string>();
  const runner = async (file: string, args: string[], opts?: { stdin?: string }): Promise<{ stdout: string; stderr: string }> => {
    const cmd = args[0];
    const aIdx = args.indexOf("-a") + 1;
    const key = args[aIdx];
    if (cmd === "add-generic-password") {
      secrets.set(key, opts?.stdin?.replace(/\n$/, "") ?? "");
      return { stdout: "", stderr: "" };
    }
    if (cmd === "find-generic-password") {
      const v = secrets.get(key);
      if (v == null) throw Object.assign(new Error("not found"), { code: 44 });
      return { stdout: `${v}\n`, stderr: "" };
    }
    if (cmd === "delete-generic-password") {
      if (!secrets.delete(key)) throw Object.assign(new Error("not found"), { code: 44 });
      return { stdout: "", stderr: "" };
    }
    throw new Error(`Unknown: ${cmd}`);
  };

  return new VaultStore({ keychainRunner: runner });
}

test("VaultStore.set returns a vault:// ref and list() shows it", async () => {
  const store = await makeVaultStore();
  const ref = await store.set("site", "github.com", "hunter2", "GitHub personal token");
  assert.equal(ref, "vault://site/github.com");
  const entries = store.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].ref, ref);
  assert.equal(entries[0].scope, "site");
  assert.equal(entries[0].name, "github.com");
  assert.equal(entries[0].label, "GitHub personal token");
  // value must NOT appear in entry
  assert.ok(!JSON.stringify(entries[0]).includes("hunter2"));
});

test("VaultStore.get resolves the ref to the plaintext value", async () => {
  const store = await makeVaultStore();
  const ref = await store.set("env", "YOUTUBE_API_KEY", "yt-key-xyz");
  const val = await store.get(ref);
  assert.equal(val, "yt-key-xyz");
});

test("VaultStore.has returns true for existing ref, false otherwise", async () => {
  const store = await makeVaultStore();
  const ref = await store.set("host", "jump-box", "pw");
  assert.equal(store.has(ref), true);
  assert.equal(store.has("vault://host/nonexistent" as VaultRef), false);
});

test("VaultStore.delete removes from Keychain and index", async () => {
  const store = await makeVaultStore();
  const ref = await store.set("env", "APCA_API_KEY_ID", "alpaca-key");
  await store.delete("env", "APCA_API_KEY_ID");
  assert.equal(store.has(ref), false);
  assert.equal(store.list().length, 0);
  await assert.rejects(() => store.get(ref));
});

test("VaultStore.list filters by scope", async () => {
  const store = await makeVaultStore();
  await store.set("site", "github.com", "gh-token");
  await store.set("site", "npm.js", "npm-token");
  await store.set("env", "X_API_KEY", "x-key");
  const siteEntries = store.list("site");
  assert.equal(siteEntries.length, 2);
  assert.ok(siteEntries.every((e) => e.scope === "site"));
});

test("VaultStore.set overwrites an existing ref without creating a duplicate", async () => {
  const store = await makeVaultStore();
  await store.set("env", "APCA_API_KEY_ID", "old");
  await store.set("env", "APCA_API_KEY_ID", "new");
  assert.equal(store.list().length, 1);
  const val = await store.get("vault://env/APCA_API_KEY_ID" as VaultRef);
  assert.equal(val, "new");
});
