import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDaemonServer } from "./server";
import { DAEMON_TOKEN_FILE, getOrCreateToken } from "@/lib/auth/token";
import { canonicalize } from "@/lib/packs/signing";
import type { PackManifestPayload, SignedPackManifest } from "@/lib/packs/types";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const PUB_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const PRIV_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function buildTarEntry(name: string, content: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(name.slice(0, 100), 0, "ascii");
  header.write("0000644\0", 100, "ascii");
  header.write("0000000\0", 108, "ascii");
  header.write("0000000\0", 116, "ascii");
  header.write(content.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  header.write("00000000000\0", 136, "ascii");
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  const padded = Buffer.alloc(Math.ceil(Math.max(content.length, 1) / 512) * 512);
  content.copy(padded);
  return Buffer.concat([header, padded]);
}

function buildTarGz(entries: Record<string, Buffer | string>): Buffer {
  const blocks = Object.entries(entries).map(([name, data]) =>
    buildTarEntry(name, typeof data === "string" ? Buffer.from(data, "utf8") : data)
  );
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function signPayload(payload: PackManifestPayload): SignedPackManifest {
  return {
    payload,
    signature: cryptoSign(null, Buffer.from(canonicalize(payload), "utf8"), PRIV_PEM).toString("base64"),
  };
}

function makePack(): Buffer {
  const files = {
    "skills/triage.md": "# Triage\nClassify inbound mail.",
    "directives/triage.json": JSON.stringify({ goal: "Triage support inbox", triggerPolicy: { type: "manual" } }),
  };
  const fileHashes: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) fileHashes[path] = sha256(Buffer.from(content, "utf8"));
  const payload: PackManifestPayload = {
    name: "support-inbox",
    version: "1.0.0",
    description: "Support Inbox pack",
    tier: "pro",
    requires: { lanes: ["mail"], permissions: ["read:mail"] },
    directives: ["directives/triage.json"],
    skills: ["skills/triage.md"],
    dashboardCard: { title: "Support Inbox", metrics: ["handled: 0"], cta: "Open" },
    uninstall: { removeDirectives: true, removeSkills: true },
    fileHashes,
  };
  return buildTarGz({ "manifest.json": JSON.stringify(signPayload(payload)), ...files });
}

async function startPackServer(t: import("node:test").TestContext) {
  const originalHome = process.env.HOME;
  const originalDbPath = process.env.HIVEMATRIX_DB_PATH;
  const tmp = mkdtempSync(join(tmpdir(), "hm-pack-routes-"));
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = join(tmp, "hivematrix.db");
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.close();
    _resetDbForTests();
    if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
    if (originalDbPath) process.env.HIVEMATRIX_DB_PATH = originalDbPath; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  };
}

test("pack routes install, list dashboard cards, and uninstall a signed pack", async (t) => {
  const { base, headers } = await startPackServer(t);
  const dataBase64 = makePack().toString("base64");

  const install = await fetch(`${base}/packs/install`, {
    method: "POST",
    headers,
    body: JSON.stringify({ dataBase64, publicKeyPem: PUB_PEM }),
  });
  assert.equal(install.status, 201);
  const installBody = await install.json() as { ok: boolean; pack: { name: string } };
  assert.equal(installBody.ok, true);
  assert.equal(installBody.pack.name, "support-inbox");

  const list = await (await fetch(`${base}/packs`, { headers })).json() as { packs: Array<{ name: string }> };
  assert.deepEqual(list.packs.map((pack) => pack.name), ["support-inbox"]);

  const cards = await (await fetch(`${base}/packs/dashboard-cards`, { headers })).json() as { cards: Array<{ packName: string; title: string }> };
  assert.deepEqual(cards.cards.map((card) => `${card.packName}:${card.title}`), ["support-inbox:Support Inbox"]);

  const uninstall = await fetch(`${base}/packs/support-inbox/uninstall`, { method: "POST", headers });
  assert.equal(uninstall.status, 200);
  const after = await (await fetch(`${base}/packs`, { headers })).json() as { packs: unknown[] };
  assert.equal(after.packs.length, 0);
});

test("pack catalog lists first-party packs and installs through signed verifier", async (t) => {
  const { base, headers } = await startPackServer(t);

  const catalog = await (await fetch(`${base}/packs/catalog`, { headers })).json() as { packs: Array<{ id: string; name: string }> };
  assert.deepEqual(catalog.packs.map((pack) => pack.id), [
    "support-inbox",
    "chief-of-staff",
    "content-engine",
    "dev-copilot",
  ]);

  const install = await fetch(`${base}/packs/catalog/chief-of-staff/install`, {
    method: "POST",
    headers,
    body: JSON.stringify({ privateKeyPem: PRIV_PEM, publicKeyPem: PUB_PEM }),
  });
  assert.equal(install.status, 201);
  const installBody = await install.json() as { ok: boolean; pack: { name: string; skillNames: string[]; directiveIds: string[] } };
  assert.equal(installBody.ok, true);
  assert.equal(installBody.pack.name, "chief-of-staff");
  assert.equal(installBody.pack.skillNames.length, 2);
  assert.equal(installBody.pack.directiveIds.length, 2);

  const cards = await (await fetch(`${base}/packs/dashboard-cards`, { headers })).json() as { cards: Array<{ packName: string; title: string }> };
  assert.deepEqual(cards.cards.map((card) => `${card.packName}:${card.title}`), ["chief-of-staff:Chief of Staff"]);
});
