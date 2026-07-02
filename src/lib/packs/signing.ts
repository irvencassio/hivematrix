/**
 * Pack signature verification — Ed25519, fail-closed.
 *
 * Pattern: identical to src/lib/license/license.ts.
 * - canonicalize() produces deterministic JSON (sorted keys) so signer and
 *   verifier hash identical bytes regardless of serialisation order.
 * - verifyPackManifest() returns false on any error, including missing key.
 * - verifyPackFileHashes() checks every file declared in payload.fileHashes so
 *   the signature covers not just metadata but every byte shipped in the pack.
 */

import { verify as cryptoVerify, createHash } from "node:crypto";
import type { PackManifestPayload, SignedPackManifest } from "./types";

/** Deterministic JSON (sorted keys) — same contract as license.ts canonicalize. */
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Verify the Ed25519 signature over canonicalize(payload).
 * Returns false on any error — no key, bad key, bad signature, or exception.
 * Fail-closed: an unsigned or wrongly-signed pack is always refused.
 */
export function verifyPackManifest(
  signed: SignedPackManifest,
  publicKeyPem: string | null,
): boolean {
  if (!publicKeyPem?.trim()) return false;
  try {
    const message = Buffer.from(canonicalize(signed.payload), "utf8");
    return cryptoVerify(null, message, publicKeyPem, Buffer.from(signed.signature, "base64"));
  } catch {
    return false;
  }
}

export interface FileHashResult {
  ok: boolean;
  /** Files declared in fileHashes that are missing or have wrong SHA-256. */
  failed: string[];
}

/**
 * Verify that every file declared in payload.fileHashes is present in the
 * tarball and its SHA-256 matches. Extra files in the tarball are ignored.
 * Any declared file that is absent or has a mismatched hash is reported.
 */
export function verifyPackFileHashes(
  files: Map<string, Buffer>,
  payload: PackManifestPayload,
): FileHashResult {
  const failed: string[] = [];
  for (const [filename, expectedHex] of Object.entries(payload.fileHashes)) {
    const content = files.get(filename);
    if (!content) {
      failed.push(filename);
      continue;
    }
    const actual = createHash("sha256").update(content).digest("hex");
    if (actual !== expectedHex) failed.push(filename);
  }
  return { ok: failed.length === 0, failed };
}

/** Compute SHA-256 hex of a buffer — convenience for pack authors. */
export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
