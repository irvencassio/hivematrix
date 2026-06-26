import type { LaneAppStatus, LaneAppVersion } from "./contracts";

// Compare two version tuples. Short version (dotted numeric) dominates; build
// number breaks ties numerically (so build "10" > build "2", not lexically).
export function compareVersions(a: LaneAppVersion, b: LaneAppVersion): number {
  const shortCmp = compareDotted(a.short, b.short);
  if (shortCmp !== 0) return shortCmp;
  return numericCompare(a.build, b.build);
}

function compareDotted(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const cmp = numericCompare(pa[i] ?? "0", pb[i] ?? "0");
    if (cmp !== 0) return cmp;
  }
  return 0;
}

function numericCompare(a: string, b: string): number {
  const na = Number.parseInt(a, 10);
  const nb = Number.parseInt(b, 10);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb ? 0 : na < nb ? -1 : 1;
  // Fall back to string compare if either side is non-numeric.
  return a === b ? 0 : a < b ? -1 : 1;
}

export interface ResolveStatusInput {
  installed: LaneAppVersion | null;
  expected: LaneAppVersion;
  /** Build identity (HMBuildId) of the installed/active copy, if present. */
  installedBuildId?: string | null;
  /** Build identity of the bundled/expected artifact, if present. */
  expectedBuildId?: string | null;
  /** From codesign + spctl. undefined = not checked. */
  signatureOk?: boolean;
  /** From the launch probe. undefined = not checked. */
  launchOk?: boolean;
}

// Status precedence is deliberate: a broken bundle is reported as broken, not as
// "just needs an update". Signature failure dominates everything; a passing
// signature with a FAILED launch is its own state (the LaunchServices lesson);
// only a healthy bundle is graded on version freshness, then build identity.
export function resolveStatus(input: ResolveStatusInput): LaneAppStatus {
  if (!input.installed) return "missing";
  if (input.signatureOk === false) return "invalid_signature";
  if (input.launchOk === false) return "launch_failed";
  const cmp = compareVersions(input.installed, input.expected);
  if (cmp < 0) return "update_available";
  // Same (or newer) version string, but a known build identity that differs from
  // the expected one → the copy is stale despite the matching version.
  if (cmp === 0 && input.installedBuildId && input.expectedBuildId && input.installedBuildId !== input.expectedBuildId) {
    return "stale_copy";
  }
  return "installed";
}
