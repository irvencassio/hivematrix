import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync, createPublicKey, verify } from "node:crypto";
import {
  parseFcmConfig,
  parseFcmDevices,
  upsertFcmDevice,
  buildFcmJwt,
  buildFcmMessage,
  registerFcmDevice,
  listFcmDevices,
  unregisterFcmDevice,
} from "./fcm";

const TMP = mkdtempSync(join(tmpdir(), "hm-fcm-test-"));
const ORIGINAL_HOME = process.env.HOME;
process.env.HOME = TMP;

test.after(() => {
  if (ORIGINAL_HOME) process.env.HOME = ORIGINAL_HOME;
  rmSync(TMP, { recursive: true, force: true });
});

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const SERVICE_ACCOUNT = {
  project_id: "proj-1",
  client_email: "svc@proj-1.iam.gserviceaccount.com",
  private_key: KEY_PEM,
};

test("parseFcmConfig requires project_id/client_email/private_key and returns null otherwise", () => {
  assert.equal(parseFcmConfig(null), null);
  assert.equal(parseFcmConfig({}), null);
  assert.equal(parseFcmConfig({ serviceAccount: { project_id: "p", client_email: "e" } }), null); // no private_key
  const cfg = parseFcmConfig({ serviceAccount: SERVICE_ACCOUNT });
  assert.deepEqual({ projectId: cfg?.projectId, clientEmail: cfg?.clientEmail, tokenUri: cfg?.tokenUri }, {
    projectId: "proj-1", clientEmail: "svc@proj-1.iam.gserviceaccount.com", tokenUri: "https://oauth2.googleapis.com/token",
  });
});

test("parseFcmConfig reads the service account from serviceAccountPath via the injected reader", () => {
  const cfg = parseFcmConfig({ serviceAccountPath: "/secret.json" }, () => JSON.stringify(SERVICE_ACCOUNT));
  assert.equal(cfg?.projectId, "proj-1");
  assert.equal(cfg?.privateKey, KEY_PEM.trim());
});

test("parseFcmConfig honors an explicit token_uri and returns null when the file read fails", () => {
  const cfg = parseFcmConfig({ serviceAccount: { ...SERVICE_ACCOUNT, token_uri: "https://example.com/token" } });
  assert.equal(cfg?.tokenUri, "https://example.com/token");
  assert.equal(parseFcmConfig({ serviceAccountPath: "/nope.json" }, () => { throw new Error("no such file"); }), null);
});

test("parseFcmDevices dedups by token, drops blanks, normalizes", () => {
  const devices = parseFcmDevices([
    { token: "a", platform: "android" },
    { token: "a", platform: "web" }, // dup dropped
    { token: "b" },
    { token: "" }, // blank dropped
    "nope",
  ]);
  assert.deepEqual(devices.map((d) => [d.token, d.platform]), [["a", "android"], ["b", undefined]]);
});

test("upsertFcmDevice replaces an existing token rather than duplicating", () => {
  const next = upsertFcmDevice([{ token: "a", platform: "android" }], { token: "a", platform: "web" });
  assert.equal(next.length, 1);
  assert.equal(next[0].platform, "web");
});

test("buildFcmJwt produces a verifiable RS256 token with the right claims", () => {
  const creds = { projectId: "proj-1", clientEmail: "svc@proj-1.iam.gserviceaccount.com", privateKey: KEY_PEM, tokenUri: "https://oauth2.googleapis.com/token" };
  const jwt = buildFcmJwt(creds, 1_700_000_000);
  const [h, p, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(p, "base64url").toString()), {
    iss: "svc@proj-1.iam.gserviceaccount.com",
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: 1_700_000_000,
    exp: 1_700_003_600,
  });
  const sig = Buffer.from(s, "base64url");
  const ok = verify("RSA-SHA256", Buffer.from(`${h}.${p}`), createPublicKey(privateKey), sig);
  assert.ok(ok, "signature should verify with the public key");
});

test("buildFcmMessage maps title/body to notification and stringifies data values", () => {
  const message = JSON.parse(buildFcmMessage("tok1", {
    title: "T",
    body: "B",
    data: { kind: "morning-briefing", n: 3, extra: { nested: true } },
  }));
  assert.deepEqual(message.message.notification, { title: "T", body: "B" });
  assert.equal(message.message.token, "tok1");
  assert.deepEqual(message.message.data, {
    kind: "morning-briefing",
    n: "3",
    extra: JSON.stringify({ nested: true }),
  });
});

test("buildFcmMessage omits data when absent or empty", () => {
  const message = JSON.parse(buildFcmMessage("tok1", { title: "T", body: "B" }));
  assert.equal("data" in message.message, false);
  const message2 = JSON.parse(buildFcmMessage("tok1", { title: "T", body: "B", data: {} }));
  assert.equal("data" in message2.message, false);
});

test("device registry persists through HiveMatrix config", () => {
  assert.deepEqual(listFcmDevices(), []);
  registerFcmDevice({ token: "tok1", platform: "android" });
  registerFcmDevice({ token: "tok2", platform: "android" });
  assert.deepEqual(listFcmDevices().map((d) => d.token).sort(), ["tok1", "tok2"]);
  // re-register tok1 → still 2 (upsert), and registeredAt stamped
  registerFcmDevice({ token: "tok1", platform: "web" });
  assert.equal(listFcmDevices().length, 2);
  assert.ok(listFcmDevices().every((d) => typeof d.registeredAt === "string"));
  unregisterFcmDevice("tok1");
  assert.deepEqual(listFcmDevices().map((d) => d.token), ["tok2"]);
});
