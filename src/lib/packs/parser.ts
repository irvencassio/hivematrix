/**
 * .hmpack parser — decompress, verify signature, verify file hashes, extract.
 *
 * A .hmpack is a gzipped TAR containing:
 *   manifest.json       — SignedPackManifest (payload + Ed25519 signature)
 *   skills/*.md         — skill markdown files
 *   directives/*.json   — directive template JSON files
 *   HEARTBEAT.md        — optional persona additions
 *
 * Verification is two-stage and fail-closed:
 *   1. Ed25519 signature over canonicalize(payload) — refuses wrong/absent key
 *   2. SHA-256 of every file declared in payload.fileHashes — refuses tampering
 */

import { parseTarGz } from "./tarball";
import { verifyPackManifest, verifyPackFileHashes } from "./signing";
import type { ParsedPack, SignedPackManifest } from "./types";

export type PackParseResult =
  | { ok: true; pack: ParsedPack }
  | { ok: false; error: string };

/**
 * Parse and verify a .hmpack buffer.
 *
 * @param buffer      Raw .hmpack bytes (gzipped TAR).
 * @param publicKeyPem  Pack issuer's Ed25519 public key in SPKI PEM format.
 *                      Pass null to unconditionally refuse (used in tests / no-key posture).
 */
export function parseHmpack(buffer: Buffer, publicKeyPem: string | null): PackParseResult {
  let files: Map<string, Buffer>;
  try {
    files = parseTarGz(buffer);
  } catch (err) {
    return { ok: false, error: `decompression failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const manifestBuf = files.get("manifest.json");
  if (!manifestBuf) return { ok: false, error: "manifest.json missing from pack" };

  let signed: SignedPackManifest;
  try {
    const raw = JSON.parse(manifestBuf.toString("utf8")) as unknown;
    if (!isSignedPackManifest(raw)) {
      return { ok: false, error: "manifest.json has invalid structure" };
    }
    signed = raw;
  } catch {
    return { ok: false, error: "manifest.json is not valid JSON" };
  }

  if (!verifyPackManifest(signed, publicKeyPem)) {
    return { ok: false, error: "pack signature verification failed" };
  }

  const hashResult = verifyPackFileHashes(files, signed.payload);
  if (!hashResult.ok) {
    return { ok: false, error: `file hash mismatch: ${hashResult.failed.join(", ")}` };
  }

  const skills: Record<string, string> = {};
  const directives: Record<string, unknown> = {};
  let personaAdditions: string | undefined;

  for (const [path, content] of files) {
    if (path === "manifest.json") continue;

    if (path === "HEARTBEAT.md") {
      personaAdditions = content.toString("utf8");
    } else if (path.startsWith("skills/") && path.endsWith(".md")) {
      skills[path] = content.toString("utf8");
    } else if (path.startsWith("directives/") && path.endsWith(".json")) {
      try {
        directives[path] = JSON.parse(content.toString("utf8"));
      } catch {
        return { ok: false, error: `directive ${path} is not valid JSON` };
      }
    }
    // Other files (future extensions) are silently ignored
  }

  const pack: ParsedPack = {
    manifest: signed.payload,
    skills,
    directives,
    ...(personaAdditions !== undefined ? { personaAdditions } : {}),
  };
  return { ok: true, pack };
}

function isSignedPackManifest(value: unknown): value is SignedPackManifest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.signature !== "string") return false;
  if (!v.payload || typeof v.payload !== "object") return false;
  const p = v.payload as Record<string, unknown>;
  return (
    typeof p.name === "string" &&
    typeof p.version === "string" &&
    typeof p.fileHashes === "object" &&
    p.fileHashes !== null
  );
}
