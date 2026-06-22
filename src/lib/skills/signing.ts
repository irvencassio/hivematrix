/**
 * Skill signing & provenance (Ed25519) — the trust differentiator. Given the
 * documented ~37%-flawed state of public skill registries, a shared skill should
 * carry a verifiable signature so the operator can auto-trust signed-by-a-known-key
 * skills and refuse/quarantine the rest. Mirrors src/lib/license crypto.
 *
 * Sign over the skill's INTRINSIC content (name+description+body+kind+interpreter)
 * so the signature attests the content, independent of scope/usage metadata.
 */

import { sign, verify, generateKeyPairSync, createHash, type KeyObject } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Skill } from "./contracts";

/** Deterministic JSON (sorted keys) — signer and verifier hash identical bytes. */
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The canonical bytes signed for a skill (intrinsic content only). Pure. */
export function skillSigningBytes(skill: Pick<Skill, "name" | "description" | "body" | "kind" | "interpreter">): Buffer {
  return Buffer.from(canonicalize({
    name: skill.name,
    description: skill.description,
    body: skill.body.trim(),
    kind: skill.kind,
    interpreter: skill.interpreter,
  }), "utf8");
}

/** Short stable fingerprint of a public key (for `signedBy`). */
export function keyFingerprint(publicKeyPem: string): string {
  return createHash("sha256").update(publicKeyPem.trim()).digest("hex").slice(0, 16);
}

/** Sign a skill with an Ed25519 private key. Returns frontmatter fields. Pure-ish. */
export function signSkill(
  skill: Pick<Skill, "name" | "description" | "body" | "kind" | "interpreter">,
  privateKeyPem: string,
  publicKeyPem: string,
): { signedBy: string; signature: string } {
  const signature = sign(null, skillSigningBytes(skill), privateKeyPem).toString("base64");
  return { signedBy: keyFingerprint(publicKeyPem), signature };
}

/** Verify a skill's signature against a public key. Pure. False on any error. */
export function verifySkillSignature(
  skill: Pick<Skill, "name" | "description" | "body" | "kind" | "interpreter" | "signature">,
  publicKeyPem: string,
): boolean {
  if (!skill.signature) return false;
  try {
    return verify(null, skillSigningBytes(skill), publicKeyPem, Buffer.from(skill.signature, "base64"));
  } catch {
    return false;
  }
}

// --- Key + trusted-signer management (IO) ----------------------------------

const KEY_DIR = join(homedir(), ".hivematrix");
const PRIV_PATH = join(KEY_DIR, "skill-signing-key.pem");
const PUB_PATH = join(KEY_DIR, "skill-signing-key.pub");

export interface SigningKey { privateKeyPem: string; publicKeyPem: string; fingerprint: string }

/** Load the operator's signing keypair, creating one on first use. Never throws to caller misuse. */
export function loadOrCreateSigningKey(): SigningKey {
  if (existsSync(PRIV_PATH) && existsSync(PUB_PATH)) {
    const privateKeyPem = readFileSync(PRIV_PATH, "utf8");
    const publicKeyPem = readFileSync(PUB_PATH, "utf8");
    return { privateKeyPem, publicKeyPem, fingerprint: keyFingerprint(publicKeyPem) };
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = (privateKey as KeyObject).export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyPem = (publicKey as KeyObject).export({ type: "spki", format: "pem" }).toString();
  mkdirSync(KEY_DIR, { recursive: true });
  writeFileSync(PRIV_PATH, privateKeyPem, { mode: 0o600 });
  writeFileSync(PUB_PATH, publicKeyPem);
  return { privateKeyPem, publicKeyPem, fingerprint: keyFingerprint(publicKeyPem) };
}

/** Read the operator's signing public key if it exists (does NOT create one). */
export function readSigningPublicKey(): string | null {
  try { return existsSync(PUB_PATH) ? readFileSync(PUB_PATH, "utf8") : null; } catch { return null; }
}

/** Public keys the operator trusts: their own + any configured signers. Pure. */
export function trustedSignerKeys(
  config: Record<string, unknown>,
  ownPublicKeyPem?: string,
): Array<{ fingerprint: string; publicKeyPem: string }> {
  const out: Array<{ fingerprint: string; publicKeyPem: string }> = [];
  if (ownPublicKeyPem) out.push({ fingerprint: keyFingerprint(ownPublicKeyPem), publicKeyPem: ownPublicKeyPem });
  const sync = (config.skillsSync ?? {}) as Record<string, unknown>;
  const signers = Array.isArray(sync.trustedSigners) ? sync.trustedSigners : [];
  for (const s of signers) {
    const pem = typeof (s as Record<string, unknown>)?.publicKeyPem === "string" ? (s as Record<string, string>).publicKeyPem : "";
    if (pem.trim()) out.push({ fingerprint: keyFingerprint(pem), publicKeyPem: pem });
  }
  return out;
}

/** True if a skill's signature verifies against ANY trusted signer key. Pure. */
export function skillSignerTrusted(
  skill: Pick<Skill, "name" | "description" | "body" | "kind" | "interpreter" | "signature">,
  trusted: Array<{ fingerprint: string; publicKeyPem: string }>,
): boolean {
  return trusted.some((k) => verifySkillSignature(skill, k.publicKeyPem));
}
