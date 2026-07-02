/** Shared types — must stay in sync with src/lib/license/license.ts */

export interface LicensePayload {
  product: string;
  edition: string;
  licensee: string;
  machineId: string | null;
  issuedAt: string;
  expiresAt: string;
  graceDays: number;
  features: string[];
}

export interface SignedLicense {
  payload: LicensePayload;
  signature: string; // base64 Ed25519 over canonicalize(payload)
}

export interface LemonSubAttrs {
  variant_id: number;
  user_email: string;
  user_name: string;
  status: string;
}

export interface LemonOrderAttrs {
  user_email: string;
  user_name: string;
  status: string;
  first_order_item?: { variant_id: number; [k: string]: unknown };
}
