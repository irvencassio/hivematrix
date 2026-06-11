/**
 * HiveMatrix auto-updater manifest types.
 *
 * The daemon fetches a signed JSON manifest from the update channel to
 * discover available releases. The manifest is verified before any
 * download begins (signature over the SHA-256 of the tarball).
 *
 * Update flow (Phase 5):
 *  1. Daemon fetches manifest from channel URL
 *  2. Verifies manifest signature
 *  3. If currentVersion < manifest.latest.version:
 *     a. Download tarball to temp dir
 *     b. Verify SHA-256 + signature
 *     c. Run SQLite migrations (forward-only, backup-first)
 *     d. Restart via launchctl kickstart
 *     e. Post-start health probe → rollback if probe fails
 */

export type UpdateChannel = "stable" | "beta";

export interface UpdateRelease {
  version: string;
  channel: UpdateChannel;
  publishedAt: string;
  tarballUrl: string;
  tarballSha256: string;
  signature: string;
  minNodeVersion: string;
  releaseNotes?: string;
  rollbackVersion?: string;
}

export interface UpdateManifest {
  schemaVersion: 1;
  channel: UpdateChannel;
  latest: UpdateRelease;
  previous: UpdateRelease | null;
  fetchedAt?: string;
}

export interface UpdaterState {
  currentVersion: string;
  channel: UpdateChannel;
  lastCheckedAt: string | null;
  lastAppliedAt: string | null;
  lastAppliedVersion: string | null;
  rollbackVersion: string | null;
  status: "idle" | "checking" | "downloading" | "applying" | "rollback" | "error";
  error?: string;
}

export function parseManifest(raw: unknown): UpdateManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== 1) return null;
  if (!r.latest || typeof r.latest !== "object") return null;
  const latest = r.latest as Record<string, unknown>;
  if (
    typeof latest.version !== "string" ||
    typeof latest.tarballUrl !== "string" ||
    typeof latest.tarballSha256 !== "string" ||
    typeof latest.signature !== "string"
  ) return null;
  const channel: UpdateChannel =
    r.channel === "stable" || r.channel === "beta" ? r.channel : "stable";
  return {
    schemaVersion: 1,
    channel,
    latest: {
      version: latest.version,
      channel,
      publishedAt: typeof latest.publishedAt === "string" ? latest.publishedAt : "",
      tarballUrl: latest.tarballUrl,
      tarballSha256: latest.tarballSha256,
      signature: latest.signature,
      minNodeVersion: typeof latest.minNodeVersion === "string" ? latest.minNodeVersion : "22",
      releaseNotes: typeof latest.releaseNotes === "string" ? latest.releaseNotes : undefined,
      rollbackVersion: typeof latest.rollbackVersion === "string" ? latest.rollbackVersion : undefined,
    },
    previous: null,
  };
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function isUpdateAvailable(currentVersion: string, manifest: UpdateManifest): boolean {
  return compareVersions(manifest.latest.version, currentVersion) > 0;
}
