import { sign as cryptoSign } from "node:crypto";
import type { LicensePayload, SignedLicense } from "./types";

const GRACE_DAYS = parseInt(process.env.LICENSE_GRACE_DAYS ?? "30", 10);
const PRO_FEATURES = ["channel_mail", "channel_message", "voice", "companion_pairing", "directives"];

/**
 * Deterministic JSON (sorted keys) — must be byte-for-byte identical to
 * src/lib/license/license.ts#canonicalize so the daemon can verify our signatures.
 */
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function signLicense(payload: LicensePayload, privateKeyPem: string): SignedLicense {
  const message = Buffer.from(canonicalize(payload), "utf8");
  return { payload, signature: cryptoSign(null, message, privateKeyPem).toString("base64") };
}

export function buildPayload(email: string, name: string, isAnnual: boolean): LicensePayload {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + (isAnnual ? 365 : 31));
  return {
    product: "hivematrix",
    edition: "pro",
    licensee: name ? `${name} <${email}>` : email,
    machineId: null, // bound on first install by the daemon
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    graceDays: GRACE_DAYS,
    features: PRO_FEATURES,
  };
}

export function isAnnualVariant(variantId: number | string): boolean {
  const annual = process.env.LEMON_VARIANT_ANNUAL ?? "";
  return annual !== "" && String(variantId) === String(annual);
}
