/**
 * Machine fingerprint for license binding.
 *
 * A stable, non-reversible id derived from host attributes — enough to bind a
 * per-appliance license to one Mac without phoning home. The appliance model
 * is one license per machine, not anti-piracy DRM.
 *
 * Prefers the hardware platform UUID (`IOPlatformUUID`, via `ioreg`) — unlike
 * `os.hostname()`, it never changes across renames, DHCP reassignment, or
 * transient Bonjour name-conflict suffixes, all of which previously caused a
 * same-machine license to spuriously report machine_mismatch. Falls back to
 * hostname+platform+arch on non-Darwin hosts or if `ioreg` is unavailable
 * (e.g. CI), so the function stays deterministic everywhere.
 *
 * Fingerprint SCHEME MIGRATIONS (e.g. hostname→UUID) must stay backward
 * compatible: a license bound under an older scheme is still THIS machine, so
 * verification accepts any fingerprint in `getMachineFingerprints()` — the
 * current scheme plus every retired one. New licenses always bind to the
 * strongest current scheme via `getMachineFingerprint()`. Without this, an old
 * install auto-updating into a new fingerprint scheme would self-lock with a
 * misleading "bound to a different machine" error and no in-field re-issue path.
 */

import { createHash } from "crypto";
import { execFileSync } from "child_process";
import os from "os";

function fingerprint(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

function hardwareUuid(): string | null {
  if (os.platform() !== "darwin") return null;
  try {
    const out = execFileSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8" });
    const match = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Current-scheme fingerprint: hardware UUID when available, else hostname. */
function currentFingerprint(): string {
  const uuid = hardwareUuid();
  const raw = uuid ? [uuid, os.platform(), os.arch()].join("|") : [os.hostname(), os.platform(), os.arch()].join("|");
  return fingerprint(raw);
}

/** Legacy-scheme fingerprint (pre-UUID, hostname-based). Always computable. */
function legacyHostnameFingerprint(): string {
  return fingerprint([os.hostname(), os.platform(), os.arch()].join("|"));
}

/** The fingerprint NEW licenses bind to — always the strongest current scheme. */
export function getMachineFingerprint(): string {
  return currentFingerprint();
}

/**
 * Every fingerprint that identifies THIS machine — the current scheme plus all
 * retired ones — deduped. Verification accepts a license bound to any of these
 * so a fingerprint-scheme migration never invalidates a same-machine license.
 */
export function getMachineFingerprints(): string[] {
  return [...new Set([currentFingerprint(), legacyHostnameFingerprint()])];
}
