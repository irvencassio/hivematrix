import { sign as cryptoSign, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { PackCatalogEntry } from "./catalog";
import { canonicalize } from "./signing";
import type { PackManifestPayload, SignedPackManifest } from "./types";

function tarString(value: string, length: number): Buffer {
  const out = Buffer.alloc(length);
  out.write(value.slice(0, length), 0, "utf8");
  return out;
}

function tarOctal(value: number, length: number): Buffer {
  const raw = value.toString(8).padStart(length - 1, "0") + "\0";
  return tarString(raw, length);
}

function splitTarPath(path: string): { name: string; prefix: string } {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    const prefix = parts.slice(0, i).join("/");
    const name = parts.slice(i).join("/");
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  throw new Error(`tar path too long: ${path}`);
}

function tarHeader(path: string, content: Buffer): Buffer {
  const h = Buffer.alloc(512);
  const { name, prefix } = splitTarPath(path);
  tarString(name, 100).copy(h, 0);
  tarOctal(0o644, 8).copy(h, 100);
  tarOctal(0, 8).copy(h, 108);
  tarOctal(0, 8).copy(h, 116);
  tarOctal(content.length, 12).copy(h, 124);
  tarOctal(Math.floor(Date.now() / 1000), 12).copy(h, 136);
  Buffer.from("        ", "ascii").copy(h, 148);
  h[156] = "0".charCodeAt(0);
  tarString("ustar", 6).copy(h, 257);
  tarString("00", 2).copy(h, 263);
  if (prefix) tarString(prefix, 155).copy(h, 345);
  let sum = 0;
  for (const byte of h) sum += byte;
  tarOctal(sum, 8).copy(h, 148);
  return h;
}

function tarFile(path: string, content: Buffer): Buffer {
  const pad = Buffer.alloc((512 - (content.length % 512)) % 512);
  return Buffer.concat([tarHeader(path, content), content, pad]);
}

function buildTar(files: Record<string, Buffer>): Buffer {
  const blocks: Buffer[] = [];
  for (const [path, content] of Object.entries(files)) blocks.push(tarFile(path, content));
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function hashFiles(files: Record<string, Buffer>): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    hashes[path] = createHash("sha256").update(content).digest("hex");
  }
  return hashes;
}

export function catalogEntryFiles(entry: PackCatalogEntry): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  for (const [path, body] of Object.entries(entry.skills)) files[path] = Buffer.from(body, "utf8");
  for (const [path, body] of Object.entries(entry.directives)) files[path] = Buffer.from(JSON.stringify(body, null, 2), "utf8");
  if (entry.personaAdditions) files["HEARTBEAT.md"] = Buffer.from(entry.personaAdditions, "utf8");
  return files;
}

export function buildSignedCatalogPack(entry: PackCatalogEntry, privateKeyPem: string): Buffer {
  if (!privateKeyPem.trim()) throw new Error("pack signing private key is required");
  const files = catalogEntryFiles(entry);
  const payload: PackManifestPayload = {
    ...entry.manifest,
    fileHashes: hashFiles(files),
  };
  const signature = cryptoSign(null, Buffer.from(canonicalize(payload), "utf8"), privateKeyPem).toString("base64");
  const signed: SignedPackManifest = { payload, signature };
  return gzipSync(buildTar({
    "manifest.json": Buffer.from(JSON.stringify(signed, null, 2), "utf8"),
    ...files,
  }));
}
