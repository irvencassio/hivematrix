/**
 * Emit build/developer-id/<version>-b<build>/release-metadata.json describing a
 * Developer ID build: identity, version/build, git commit, notarization status,
 * and every artifact with its sha256. Consumed by humans + worker models to
 * confirm exactly what was produced.
 *
 *   node scripts/write-release-metadata.mjs <out-dir> <notarization-status> [artifact ...]
 *
 * <notarization-status> is one of: notarized | signed-not-notarized | none.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export const SIGNING_IDENTITY = "Developer ID Application: Irven Cassio (8B3CHTY93V)";
export const FEED_ASSET = "hivematrix-core.json";

/** Pure: assemble the metadata object (no fs/sha). Tested-shape helper. */
export function assembleMetadata({ productName, bundleId, version, buildNumber, gitCommit, notarization, artifacts }) {
  return {
    productName,
    bundleId,
    version,
    buildNumber,
    gitCommit,
    signingIdentity: SIGNING_IDENTITY,
    notarizationStatus: notarization,
    feed: {
      asset: FEED_ASSET,
      url: `https://github.com/irvencassio/hivematrix/releases/latest/download/${FEED_ASSET}`,
    },
    artifacts,
    generatedAt: new Date().toISOString(),
  };
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readRepoState(repo) {
  const tauri = JSON.parse(readFileSync(join(repo, "src-tauri/tauri.conf.json"), "utf-8"));
  const verTs = readFileSync(join(repo, "src/lib/version.ts"), "utf-8");
  const buildNumber = Number(verTs.match(/BUILD_NUMBER\s*=\s*([0-9]+)/)?.[1] ?? 0) || null;
  let gitCommit = null;
  try { gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf-8" }).trim(); } catch { /* not a repo */ }
  return {
    productName: tauri.productName ?? "HiveMatrix",
    bundleId: tauri.identifier ?? null,
    version: tauri.version ?? null,
    buildNumber,
    gitCommit,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [outDir, notarization, ...artifactPaths] = process.argv.slice(2);
  if (!outDir || !notarization) {
    console.error("usage: write-release-metadata.mjs <out-dir> <notarized|signed-not-notarized|none> [artifact ...]");
    process.exit(2);
  }
  const repo = process.cwd();
  const state = readRepoState(repo);
  const artifacts = artifactPaths
    .filter((p) => existsSync(p))
    .map((p) => ({ path: p, bytes: statSync(p).size, sha256: sha256(p) }));

  const metadata = assembleMetadata({ ...state, notarization, artifacts });
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, "release-metadata.json");
  writeFileSync(out, JSON.stringify(metadata, null, 2) + "\n");
  console.log(out);
}
