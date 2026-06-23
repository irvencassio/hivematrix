import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync, createPublicKey, verify } from "node:crypto";
import {
  parseApnsConfig,
  parseApnsDevices,
  upsertDevice,
  buildApnsJwt,
  buildApnsPayload,
  groupDevicesByHost,
  registerApnsDevice,
  listApnsDevices,
  unregisterApnsDevice,
  type ApnsConfig,
} from "./apns";

const TMP = mkdtempSync(join(tmpdir(), "hm-apns-test-"));
const ORIGINAL_HOME = process.env.HOME;
process.env.HOME = TMP;

test.after(() => {
  if (ORIGINAL_HOME) process.env.HOME = ORIGINAL_HOME;
  rmSync(TMP, { recursive: true, force: true });
});

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

test("parseApnsConfig requires all fields and returns null otherwise", () => {
  assert.equal(parseApnsConfig(null), null);
  assert.equal(parseApnsConfig({ keyId: "K", teamId: "T", bundleId: "B" }), null); // no key
  const cfg = parseApnsConfig({ keyId: "K", teamId: "T", bundleId: "com.x", key: KEY_PEM, production: true });
  assert.deepEqual({ keyId: cfg?.keyId, teamId: cfg?.teamId, bundleId: cfg?.bundleId, production: cfg?.production }, {
    keyId: "K", teamId: "T", bundleId: "com.x", production: true,
  });
});

test("parseApnsConfig reads the key from keyPath via the injected reader", () => {
  const cfg = parseApnsConfig({ keyId: "K", teamId: "T", bundleId: "B", keyPath: "/secret.p8" }, () => KEY_PEM);
  assert.equal(cfg?.key, KEY_PEM);
});

test("parseApnsDevices dedups by token and normalizes env", () => {
  const devices = parseApnsDevices([
    { token: "a", env: "production" },
    { token: "a", env: "sandbox" }, // dup dropped
    { token: "b", env: "bogus" },   // bad env normalized to undefined
    { token: "" },                   // blank dropped
    "nope",
  ]);
  assert.deepEqual(devices.map((d) => [d.token, d.env]), [["a", "production"], ["b", undefined]]);
});

test("upsertDevice replaces an existing token rather than duplicating", () => {
  const next = upsertDevice([{ token: "a", env: "sandbox" }], { token: "a", env: "production" });
  assert.equal(next.length, 1);
  assert.equal(next[0].env, "production");
});

test("buildApnsJwt produces a verifiable ES256 token with the right claims", () => {
  const jwt = buildApnsJwt({ keyId: "KID1", teamId: "TEAM1", bundleId: "B", key: KEY_PEM }, 1_700_000_000);
  const [h, p, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "ES256", kid: "KID1" });
  assert.deepEqual(JSON.parse(Buffer.from(p, "base64url").toString()), { iss: "TEAM1", iat: 1_700_000_000 });
  const sig = Buffer.from(s, "base64url");
  const ok = verify("sha256", Buffer.from(`${h}.${p}`), { key: createPublicKey(privateKey), dsaEncoding: "ieee-p1363" }, sig);
  assert.ok(ok, "signature should verify with the public key");
});

test("buildApnsPayload wraps the alert and merges custom data", () => {
  const payload = JSON.parse(buildApnsPayload({ title: "T", body: "B", data: { kind: "morning-briefing" } }));
  assert.deepEqual(payload.aps.alert, { title: "T", body: "B" });
  assert.equal(payload.kind, "morning-briefing");
});

test("groupDevicesByHost splits prod vs sandbox, honoring per-device env over the default", () => {
  const config = { production: false } as ApnsConfig;
  const groups = groupDevicesByHost(
    [{ token: "a" }, { token: "b", env: "production" }],
    config,
  );
  const hosts = [...groups.keys()].sort();
  assert.equal(hosts.length, 2);
  // default (sandbox) for "a", explicit production for "b"
  assert.ok([...groups.values()].some((list) => list.some((d) => d.token === "a")));
  assert.ok([...groups.values()].some((list) => list.some((d) => d.token === "b")));
});

test("device registry persists through HiveMatrix config", () => {
  assert.deepEqual(listApnsDevices(), []);
  registerApnsDevice({ token: "tok1", env: "sandbox", platform: "ios" });
  registerApnsDevice({ token: "tok2", env: "production", platform: "ios" });
  assert.deepEqual(listApnsDevices().map((d) => d.token).sort(), ["tok1", "tok2"]);
  // re-register tok1 → still 2 (upsert), and registeredAt stamped
  registerApnsDevice({ token: "tok1", env: "production" });
  assert.equal(listApnsDevices().length, 2);
  assert.ok(listApnsDevices().every((d) => typeof d.registeredAt === "string"));
  unregisterApnsDevice("tok1");
  assert.deepEqual(listApnsDevices().map((d) => d.token), ["tok2"]);
});
