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
 */

import { createHash } from "crypto";
import { execFileSync } from "child_process";
import os from "os";

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

export function getMachineFingerprint(): string {
  const uuid = hardwareUuid();
  const raw = uuid ? [uuid, os.platform(), os.arch()].join("|") : [os.hostname(), os.platform(), os.arch()].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}
