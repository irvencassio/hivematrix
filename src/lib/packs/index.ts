/**
 * Packs — installable outcome packs (.hmpack signed tarballs).
 *
 * Each pack bundles a manifest, directive templates, skill markdown files,
 * and a dashboard card schema into a signed tarball that delivers a job
 * end-to-end (Support Inbox, Chief-of-Staff, Content Engine, Dev Copilot).
 * Packs compose skills/, directive templates, and lane config — they do not
 * own those primitives.
 *
 * Signing: Ed25519 (third keypair, operator-held). Daemon refuses unsigned
 * packs. First-party packs only at launch; third-party skills remain
 * trusted:false until operator approval (existing mechanism).
 *
 * Import restrictions (enforced by scope-wall):
 *   - Only daemon/ may import packs/.
 *   - packs/ must NOT import from orchestrator/.
 */

export type { PackManifest, PackManifestPayload, SignedPackManifest, ParsedPack, PackTier, PackDashboardCard } from "./types";
export { canonicalize, verifyPackManifest, verifyPackFileHashes, sha256Hex } from "./signing";
export { parseTar, parseTarGz } from "./tarball";
export { parseHmpack } from "./parser";
export type { PackParseResult } from "./parser";
export { buildSignedCatalogPack, catalogEntryFiles } from "./builder";
export { getPackCatalog, getPackCatalogEntry, PACK_CATALOG } from "./catalog";
export type { PackCatalogEntry } from "./catalog";
