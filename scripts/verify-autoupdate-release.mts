#!/usr/bin/env tsx
/**
 * Verify that the current checkout is actually represented by the live
 * HiveMatrix auto-update feed.
 *
 * This is intentionally stricter than "does a GitHub release exist?":
 * installed apps update by version, so a code change is not released until
 * v<version>, the GitHub release, and latest.json all point at this HEAD.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { evaluateAutoUpdateProof } from "../src/lib/updater/release-proof";

const REPO = "irvencassio/hivematrix";
const FEED_URL = `https://github.com/${REPO}/releases/latest/download/latest.json`;

function sh(cmd: string, args: string[], fallback: string | null = null): string | null {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return fallback;
  }
}

function sourceVersionInfo(): { version: string; buildNumber: number | null } {
  const src = readFileSync("src/lib/version.ts", "utf8");
  const version = src.match(/export const VERSION = "([^"]+)"/)?.[1] ?? "";
  const build = src.match(/export const BUILD_NUMBER = ([0-9]+)/)?.[1] ?? "";
  return { version, buildNumber: build ? Number(build) : null };
}

async function main(): Promise<void> {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version?: string };
  const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")) as { version?: string };
  const src = sourceVersionInfo();
  const version = tauri.version ?? "";
  const tagName = `v${version}`;
  const headCommit = sh("git", ["rev-parse", "HEAD"], "")!;

  const peeled = sh("git", ["ls-remote", "--tags", "origin", `refs/tags/${tagName}^{}`], "");
  const direct = sh("git", ["ls-remote", "--tags", "origin", `refs/tags/${tagName}`], "");
  const tagCommit = (peeled || direct || "")
    .split(/\s+/)[0] || sh("git", ["rev-list", "-n", "1", tagName], null);

  const releaseExists = sh("gh", ["release", "view", tagName, "--repo", REPO, "--json", "tagName"], null) !== null;

  let feedVersion: string | null = null;
  let feedSourceCommit: string | null = null;
  try {
    const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const feed = await res.json() as { version?: string; sourceCommit?: string };
      feedVersion = typeof feed.version === "string" ? feed.version : null;
      feedSourceCommit = typeof feed.sourceCommit === "string" ? feed.sourceCommit : null;
    }
  } catch {
    // Reported by missing feed checks below.
  }

  const proof = evaluateAutoUpdateProof({
    headCommit,
    packageVersion: pkg.version ?? "",
    tauriVersion: version,
    sourceVersion: src.version,
    buildNumber: src.buildNumber,
    tagName,
    tagCommit,
    releaseExists,
    feedVersion,
    feedSourceCommit,
  });

  console.log(`HiveMatrix auto-update release proof for ${tagName}`);
  for (const check of proof.checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.id}: ${check.detail}`);
  }

  if (!proof.ok) {
    console.error("\nAuto-update feed does not prove this checkout. Bump version/build, build, publish, then rerun this proof.");
    process.exit(1);
  }
  console.log("\n✓ Auto-update feed proves this checkout.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
