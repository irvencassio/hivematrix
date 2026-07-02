/**
 * Licensing (W7.3) — Ed25519-signed, machine-bound, offline-friendly.
 *
 * The appliance model is one signed license per machine. Verification is
 * entirely local (no phone-home) so it works in 100%-local posture, and it
 * fails *open* on absence (a missing license never bricks the box — it shows a
 * banner) while failing *closed* on tampering/expiry-beyond-grace. A grace
 * period after expiry keeps a running appliance alive past renewal day.
 *
 * Lemon Squeezy checkout → license issuance is a stateless webhook receiver (P3.2);
 * this module only verifies the issued artifact locally.
 */

import { verify } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { loadHiveConfig } from "@/lib/central/config";
import { getMachineFingerprint } from "./machine";

/** Embedded issuer public key (SPKI PEM). Empty until the Stripe-issuance key ships. */
export const LICENSE_ISSUER_PUBLIC_KEY_PEM = "";

export interface LicensePayload {
  product: string;
  edition: string;
  licensee: string;
  machineId: string | null; // null = not machine-bound
  issuedAt: string;
  expiresAt: string;
  graceDays: number;
  features: string[];
}

export interface SignedLicense {
  payload: LicensePayload;
  signature: string; // base64 Ed25519 over canonicalize(payload)
}

export type LicenseState =
  | "valid"
  | "grace"
  | "expired"
  | "invalid"
  | "missing"
  | "unlicensed"
  | "machine_mismatch";

export interface LicenseStatus {
  state: LicenseState;
  /** Whether the daemon should consider itself permitted (advisory in v1 — boot never hard-blocks). */
  permitted: boolean;
  reason: string;
  edition?: string;
  features?: string[];
  expiresAt?: string;
  graceUntil?: string;
  daysRemaining?: number;
}

const DAY_MS = 86_400_000;

function licenseFilePath(): string {
  return join(homedir(), ".hivematrix", "license.json");
}

/** Deterministic JSON (sorted keys) so signer and verifier hash identical bytes. */
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Pure verifier: signature → machine binding → expiry/grace. */
export function verifyLicense(
  signed: SignedLicense | null,
  publicKeyPem: string,
  opts: { machineId: string; now: Date },
): LicenseStatus {
  if (!signed) return { state: "missing", permitted: true, reason: "no license installed" };
  if (!publicKeyPem.trim()) return { state: "unlicensed", permitted: true, reason: "no issuer public key configured" };

  let sigOk = false;
  try {
    sigOk = verify(null, Buffer.from(canonicalize(signed.payload), "utf8"), publicKeyPem, Buffer.from(signed.signature, "base64"));
  } catch {
    sigOk = false;
  }
  if (!sigOk) return { state: "invalid", permitted: false, reason: "signature verification failed" };

  const p = signed.payload;
  if (p.machineId && p.machineId !== opts.machineId) {
    return { state: "machine_mismatch", permitted: false, reason: "license bound to a different machine", edition: p.edition };
  }

  const exp = Date.parse(p.expiresAt);
  if (!Number.isFinite(exp)) return { state: "invalid", permitted: false, reason: "license has an invalid expiry" };

  const now = opts.now.getTime();
  if (now <= exp) {
    return {
      state: "valid",
      permitted: true,
      reason: "license valid",
      edition: p.edition,
      features: p.features,
      expiresAt: p.expiresAt,
      daysRemaining: Math.ceil((exp - now) / DAY_MS),
    };
  }

  const graceEnd = exp + Math.max(0, p.graceDays) * DAY_MS;
  if (now <= graceEnd) {
    return {
      state: "grace",
      permitted: true,
      reason: "license expired but within grace period",
      edition: p.edition,
      features: p.features,
      expiresAt: p.expiresAt,
      graceUntil: new Date(graceEnd).toISOString(),
      daysRemaining: Math.ceil((graceEnd - now) / DAY_MS),
    };
  }

  return { state: "expired", permitted: false, reason: "license expired beyond grace", edition: p.edition, expiresAt: p.expiresAt };
}

/** Resolve the issuer public key: config override → env → embedded. */
export function resolveIssuerPublicKey(): string {
  const cfg = loadHiveConfig();
  const lic = (cfg.license ?? {}) as Record<string, unknown>;
  if (typeof lic.publicKeyPem === "string" && lic.publicKeyPem.trim()) return lic.publicKeyPem;
  if (process.env.HIVEMATRIX_LICENSE_PUBKEY) return process.env.HIVEMATRIX_LICENSE_PUBKEY;
  return LICENSE_ISSUER_PUBLIC_KEY_PEM;
}

export function loadLicense(): SignedLicense | null {
  try {
    const parsed = JSON.parse(readFileSync(licenseFilePath(), "utf-8")) as SignedLicense;
    if (parsed && parsed.payload && typeof parsed.signature === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

/** The daemon's view: load the local license and verify it against this machine + now. */
export function getLicenseStatus(now: Date = new Date()): LicenseStatus {
  return verifyLicense(loadLicense(), resolveIssuerPublicKey(), { machineId: getMachineFingerprint(), now });
}

/** Install a license file (e.g. POSTed from setup or a Stripe webhook), then re-evaluate. */
export function installLicense(signed: SignedLicense, now: Date = new Date()): LicenseStatus {
  const dir = join(homedir(), ".hivematrix");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(licenseFilePath(), JSON.stringify(signed, null, 2), { mode: 0o600 });
  return getLicenseStatus(now);
}
