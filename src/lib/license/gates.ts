/**
 * License enforcement gates — the single place that maps Pro-only capabilities
 * to the current license status. Call these at enforcement points; do not
 * sprinkle tier checks through business logic.
 *
 * Design: fail-open. A missing or unconfigured license means Free tier — it
 * never bricks the machine. Invalid/tampered signatures and post-grace expiry
 * also land on Free (user loses Pro access, nothing more).
 *
 * Free tier: local models only, terminal/browser/desktop lanes, console UI.
 * Pro tier ($39/mo or $349/yr): all channels, voice, directives, companion pairing.
 */

import { getLicenseStatus, type LicenseStatus } from "./license";

export type GatedFeature =
  | "channel_mail"
  | "channel_message"
  | "voice"
  | "companion_pairing"
  | "directives";

const FEATURE_LABEL: Record<GatedFeature, string> = {
  channel_mail: "Mail Lane",
  channel_message: "Message Lane",
  voice: "Voice",
  companion_pairing: "Companion pairing",
  directives: "Directives",
};

const PRO_FEATURES = new Set<GatedFeature>([
  "channel_mail",
  "channel_message",
  "voice",
  "companion_pairing",
  "directives",
]);

/** True only when the license is an active (valid or grace) Pro license. */
export function isProLicense(status?: LicenseStatus): boolean {
  const s = status ?? getLicenseStatus();
  return (s.state === "valid" || s.state === "grace") && s.edition === "pro";
}

/** True when the feature is permitted under the current license. */
export function isFeaturePermitted(feature: GatedFeature, status?: LicenseStatus): boolean {
  if (!PRO_FEATURES.has(feature)) return true;
  return isProLicense(status ?? getLicenseStatus());
}

export interface GateResult {
  permitted: boolean;
  /** True when the block is purely "no Pro license present" — show upgrade CTA, not error. */
  upgradeRequired: boolean;
  reason: string;
}

/**
 * Check a Pro-only feature gate and return a structured result for HTTP
 * enforcement points. Returns `{ permitted: true }` for free features or
 * when a valid Pro license is active. Pass `status` in tests to avoid
 * loading the real license file.
 */
export function checkGate(feature: GatedFeature, status?: LicenseStatus): GateResult {
  if (!PRO_FEATURES.has(feature)) {
    return { permitted: true, upgradeRequired: false, reason: "free feature" };
  }
  const s = status ?? getLicenseStatus();
  if (isProLicense(s)) {
    return { permitted: true, upgradeRequired: false, reason: "pro license active" };
  }
  const label = FEATURE_LABEL[feature];
  const noLicense = s.state === "missing" || s.state === "unlicensed";
  return {
    permitted: false,
    upgradeRequired: noLicense,
    reason: noLicense
      ? `${label} requires a Pro license — upgrade at hivematrix.app/pricing`
      : `${label} locked: license ${s.state} (${s.reason})`,
  };
}
