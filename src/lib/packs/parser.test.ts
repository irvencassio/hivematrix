import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { parseHmpack } from "./parser";
import { canonicalize } from "./signing";
import type { PackManifestPayload, SignedPackManifest } from "./types";

// --- Key pair for tests ---

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const PUB_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const PRIV_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

// --- TAR builder (POSIX ustar, for constructing test packs in-process) ---

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function buildTarEntry(name: string, content: Buffer): Buffer {
  const header = Buffer.alloc(512);

  // Filename (max 100 chars)
  header.write(name.slice(0, 100), 0, "ascii");
  // Mode: 0644
  header.write("0000644\0", 100, "ascii");
  // UID, GID
  header.write("0000000\0", 108, "ascii");
  header.write("0000000\0", 116, "ascii");
  // File size in octal (11 chars + null)
  header.write(content.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  // mtime (0)
  header.write("00000000000\0", 136, "ascii");
  // Checksum placeholder — 8 spaces
  header.fill(0x20, 148, 156);
  // Type flag: '0' = regular file
  header[156] = 0x30;
  // UStar magic + version
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");

  // Compute checksum with 8 spaces in the checksum field
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");

  // Content padded to 512-byte boundary
  const padLen = Math.ceil(Math.max(content.length, 1) / 512) * 512;
  const padded = Buffer.alloc(padLen);
  content.copy(padded);

  return Buffer.concat([header, padded]);
}

function buildTarGz(entries: Record<string, Buffer | string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, data] of Object.entries(entries)) {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    blocks.push(buildTarEntry(name, buf));
  }
  blocks.push(Buffer.alloc(1024)); // end-of-archive: two zero blocks
  return gzipSync(Buffer.concat(blocks));
}

// --- Pack builder helpers ---

function makePayload(
  fileEntries: Record<string, string>,
  over: Partial<PackManifestPayload> = {},
): PackManifestPayload {
  const fileHashes: Record<string, string> = {};
  for (const [path, content] of Object.entries(fileEntries)) {
    fileHashes[path] = sha256(Buffer.from(content, "utf8"));
  }
  return {
    name: "support-inbox",
    version: "1.0.0",
    description: "Support Inbox pack",
    tier: "pro",
    requires: { lanes: ["mail"], permissions: ["read:mail"] },
    directives: ["directives/triage.json"],
    skills: ["skills/triage.md"],
    dashboardCard: { title: "Support Inbox", metrics: ["handled: 0"] },
    uninstall: { removeDirectives: true, removeSkills: true },
    fileHashes,
    ...over,
  };
}

function signPayload(payload: PackManifestPayload): SignedPackManifest {
  const sig = cryptoSign(null, Buffer.from(canonicalize(payload), "utf8"), PRIV_PEM).toString("base64");
  return { payload, signature: sig };
}

function makeHmpack(
  fileEntries: Record<string, string>,
  payloadOverride?: Partial<PackManifestPayload>,
): Buffer {
  const payload = makePayload(fileEntries, payloadOverride);
  const signed = signPayload(payload);
  return buildTarGz({
    "manifest.json": JSON.stringify(signed),
    ...fileEntries,
  });
}

// --- Tests ---

test("well-formed signed pack parses successfully", () => {
  const files = {
    "skills/triage.md": "# Triage\nClassify inbound mail.",
    "directives/triage.json": JSON.stringify({ name: "triage", schedule: "*/5 * * * *" }),
  };
  const pack = buildTarGz({
    "manifest.json": JSON.stringify(signPayload(makePayload(files))),
    ...files,
  });
  const result = parseHmpack(pack, PUB_PEM);
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.equal(result.pack.manifest.name, "support-inbox");
  assert.ok("skills/triage.md" in result.pack.skills);
  assert.ok("directives/triage.json" in result.pack.directives);
  assert.equal(result.pack.personaAdditions, undefined);
});

test("HEARTBEAT.md is captured in personaAdditions", () => {
  const files = { "HEARTBEAT.md": "You are also a support specialist.\n" };
  const result = parseHmpack(makeHmpack(files), PUB_PEM);
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.equal(result.pack.personaAdditions, files["HEARTBEAT.md"]);
});

test("missing manifest.json → error", () => {
  const pack = buildTarGz({ "skills/triage.md": "# Triage" });
  const result = parseHmpack(pack, PUB_PEM);
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("manifest.json"));
});

test("non-JSON manifest → error", () => {
  const pack = buildTarGz({ "manifest.json": "NOT JSON" });
  const result = parseHmpack(pack, PUB_PEM);
  assert.equal(result.ok, false);
});

test("manifest missing required fields → invalid structure error", () => {
  const pack = buildTarGz({ "manifest.json": JSON.stringify({ hello: "world" }) });
  const result = parseHmpack(pack, PUB_PEM);
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("invalid structure"));
});

test("wrong signing key → signature verification failed", () => {
  const { privateKey: otherPriv } = generateKeyPairSync("ed25519");
  const otherPrivPem = otherPriv.export({ type: "pkcs8", format: "pem" }).toString();
  const files = { "skills/triage.md": "# Triage" };
  const payload = makePayload(files);
  const sig = cryptoSign(null, Buffer.from(canonicalize(payload), "utf8"), otherPrivPem).toString("base64");
  const pack = buildTarGz({
    "manifest.json": JSON.stringify({ payload, signature: sig }),
    ...files,
  });
  const result = parseHmpack(pack, PUB_PEM);
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("signature"));
});

test("null public key → signature verification failed (no-key posture)", () => {
  const result = parseHmpack(makeHmpack({}), null);
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("signature"));
});

test("file hash mismatch → error naming the tampered file", () => {
  const original = "# Triage\nstep 1\n";
  const tampered = "rm -rf /\n";
  const payload = makePayload({ "skills/triage.md": original });
  const signed = signPayload(payload);
  // Put the tampered content in the tarball but the hash covers the original
  const pack = buildTarGz({
    "manifest.json": JSON.stringify(signed),
    "skills/triage.md": tampered,
  });
  const result = parseHmpack(pack, PUB_PEM);
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("skills/triage.md"));
});

test("file declared in fileHashes but absent from tarball → error", () => {
  const payload = makePayload({ "skills/triage.md": "# Triage" });
  const signed = signPayload(payload);
  // Omit the skill file from the tarball
  const pack = buildTarGz({ "manifest.json": JSON.stringify(signed) });
  const result = parseHmpack(pack, PUB_PEM);
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("skills/triage.md"));
});

test("corrupted gzip → decompression error", () => {
  const result = parseHmpack(Buffer.from("this is not gzip", "utf8"), PUB_PEM);
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("decompression"));
});

test("invalid directive JSON → error naming the file", () => {
  const files = { "directives/bad.json": "{ NOT JSON }" };
  const payload = makePayload(files);
  const signed = signPayload(payload);
  const pack = buildTarGz({ "manifest.json": JSON.stringify(signed), ...files });
  const result = parseHmpack(pack, PUB_PEM);
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("directives/bad.json"));
});

test("extra files in tarball not in fileHashes are silently ignored", () => {
  const declaredFiles = { "skills/triage.md": "# Triage" };
  const payload = makePayload(declaredFiles);
  const signed = signPayload(payload);
  const pack = buildTarGz({
    "manifest.json": JSON.stringify(signed),
    "skills/triage.md": declaredFiles["skills/triage.md"],
    "extra-unknown-file.txt": "ignored",
  });
  const result = parseHmpack(pack, PUB_PEM);
  assert.ok(result.ok, result.ok ? "" : result.error);
});
