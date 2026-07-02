export type PackTier = "pro";

export type PackDashboardCard = {
  title: string;
  metrics: string[];
  cta?: string;
};

export type PackManifest = {
  name: string;
  version: string;
  description: string;
  tier: PackTier;
  requires: {
    lanes: string[];
    permissions: string[];
  };
  directives: string[];
  skills: string[];
  dashboardCard: PackDashboardCard;
  uninstall: {
    removeDirectives: boolean;
    removeSkills: boolean;
  };
};

/**
 * The signable portion of a pack manifest — all fields plus file content
 * hashes so the signature covers every file in the pack, not just metadata.
 * fileHashes maps tarball path → sha256hex (e.g. "skills/triage.md" → "…").
 */
export type PackManifestPayload = PackManifest & {
  fileHashes: Record<string, string>;
};

/** Serialised form stored as manifest.json inside the .hmpack tarball. */
export type SignedPackManifest = {
  payload: PackManifestPayload;
  signature: string; // base64 Ed25519 over canonicalize(payload)
};

/** Result of successfully parsing and verifying a .hmpack file. */
export type ParsedPack = {
  manifest: PackManifestPayload;
  skills: Record<string, string>; // tarball path → markdown content
  directives: Record<string, unknown>; // tarball path → parsed JSON
  personaAdditions?: string; // HEARTBEAT.md content, if present
};
