/**
 * Machine fingerprint for license binding.
 *
 * A stable, non-reversible id derived from host attributes — enough to bind a
 * per-appliance license to one Mac without phoning home. Deliberately coarse
 * (hostname + platform + arch) so it survives OS updates; the appliance model
 * is one license per machine, not anti-piracy DRM.
 */

import { createHash } from "crypto";
import os from "os";

export function getMachineFingerprint(): string {
  const raw = [os.hostname(), os.platform(), os.arch()].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}
