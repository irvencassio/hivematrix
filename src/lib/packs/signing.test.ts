import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign, createHash } from "node:crypto";
import { canonicalize, verifyPackManifest, verifyPackFileHashes, sha256Hex } from "./signing";
import type { PackManifestPayload, SignedPackManifest } from "./types";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const PUB_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const PRIV_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function makePayload(over: Partial<PackManifestPayload> = {}): PackManifestPayload {
  return {
    name: "support-inbox",
    version: "1.0.0",
    description: "Support Inbox pack",
    tier: "pro",
    requires: { lanes: ["mail"], permissions: ["read:mail"] },
    directives: ["directives/triage.json"],
    skills: ["skills/triage.md"],
    dashboardCard: { title: "Support Inbox", metrics: ["handled: 0", "drafts: 0"] },
    uninstall: { removeDirectives: true, removeSkills: true },
    fileHashes: {},
    ...over,
  };
}

function signPayload(payload: PackManifestPayload): SignedPackManifest {
  const sig = cryptoSign(null, Buffer.from(canonicalize(payload), "utf8"), PRIV_PEM).toString("base64");
  return { payload, signature: sig };
}

// --- canonicalize ---

test("canonicalize is key-order independent", () => {
  assert.equal(canonicalize({ b: 2, a: 1 }), canonicalize({ a: 1, b: 2 }));
});

test("canonicalize handles arrays, primitives, and nested objects", () => {
  assert.equal(canonicalize([1, "x", { z: false }]), '[1,"x",{"z":false}]');
  assert.equal(canonicalize(null), "null");
  assert.equal(canonicalize(42), "42");
});

// --- verifyPackManifest ---

test("valid signature verifies", () => {
  const signed = signPayload(makePayload());
  assert.equal(verifyPackManifest(signed, PUB_PEM), true);
});

test("tampered payload fails — fail-closed", () => {
  const signed = signPayload(makePayload());
  const tampered: SignedPackManifest = { ...signed, payload: { ...signed.payload, name: "evil-pack" } };
  assert.equal(verifyPackManifest(tampered, PUB_PEM), false);
});

test("wrong key fails — fail-closed", () => {
  const { publicKey: otherPub } = generateKeyPairSync("ed25519");
  const otherPem = otherPub.export({ type: "spki", format: "pem" }).toString();
  const signed = signPayload(makePayload());
  assert.equal(verifyPackManifest(signed, otherPem), false);
});

test("null key fails — fail-closed (no-key posture refuses all packs)", () => {
  const signed = signPayload(makePayload());
  assert.equal(verifyPackManifest(signed, null), false);
});

test("empty-string key fails — fail-closed", () => {
  const signed = signPayload(makePayload());
  assert.equal(verifyPackManifest(signed, ""), false);
});

test("corrupted base64 signature fails gracefully", () => {
  const signed = signPayload(makePayload());
  const corrupted: SignedPackManifest = { ...signed, signature: "not-valid-base64!!!" };
  assert.equal(verifyPackManifest(corrupted, PUB_PEM), false);
});

// --- verifyPackFileHashes ---

test("all hashes match → ok: true, failed: []", () => {
  const content = Buffer.from("# triage\nstep 1\n", "utf8");
  const hash = createHash("sha256").update(content).digest("hex");
  const payload = makePayload({ fileHashes: { "skills/triage.md": hash } });
  const files = new Map([["skills/triage.md", content]]);
  const result = verifyPackFileHashes(files, payload);
  assert.equal(result.ok, true);
  assert.deepEqual(result.failed, []);
});

test("missing file → failed includes filename", () => {
  const payload = makePayload({ fileHashes: { "skills/triage.md": "abc123" } });
  const files = new Map<string, Buffer>(); // empty
  const result = verifyPackFileHashes(files, payload);
  assert.equal(result.ok, false);
  assert.ok(result.failed.includes("skills/triage.md"));
});

test("tampered file content → failed includes filename", () => {
  const original = Buffer.from("# triage\nstep 1\n", "utf8");
  const hash = createHash("sha256").update(original).digest("hex");
  const payload = makePayload({ fileHashes: { "skills/triage.md": hash } });
  const tampered = new Map([["skills/triage.md", Buffer.from("rm -rf /", "utf8")]]);
  const result = verifyPackFileHashes(tampered, payload);
  assert.equal(result.ok, false);
  assert.ok(result.failed.includes("skills/triage.md"));
});

test("extra files in tarball not in fileHashes are ignored", () => {
  const payload = makePayload({ fileHashes: {} }); // no declared files
  const files = new Map([["skills/extra.md", Buffer.from("extra", "utf8")]]);
  const result = verifyPackFileHashes(files, payload);
  assert.equal(result.ok, true);
});

// --- sha256Hex ---

test("sha256Hex matches node:crypto createHash output", () => {
  const buf = Buffer.from("hello world", "utf8");
  const expected = createHash("sha256").update(buf).digest("hex");
  assert.equal(sha256Hex(buf), expected);
});
