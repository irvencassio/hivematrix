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
import { evaluateAutoUpdateProof, type AutoUpdateProof } from "../src/lib/updater/release-proof";
import { feedUrlForChannel, parseUpdateChannel } from "../src/lib/updater/channel";

const REPO = "irvencassio/hivematrix";
// Which channel this checkout was published to. Defaults to BETA to match
// scripts/publish-release.sh — verifying the stable feed after a beta publish
// would "fail" for the entirely correct reason that beta did not touch it.
//   npm run release:verify -- --stable
const CHANNEL = parseUpdateChannel(
  process.argv.includes("--stable") ? "stable"
    : process.argv.includes("--beta") ? "beta"
      : process.env.HIVEMATRIX_RELEASE_CHANNEL ?? "beta",
);
const FEED_URL = feedUrlForChannel(CHANNEL);

/**
 * GitHub's `releases/latest/download/<asset>` CDN redirect lags the release
 * "latest" pointer by a few minutes, so immediately after publishing a release
 * the feed still serves the *previous* version/commit. Only the two feed checks
 * (feed-version, feed-source-commit, feed-build-number) are subject to this lag
 * — every other check is local/API and is correct the instant it's read. So we poll *only* when the
 * sole remaining failures are feed checks, giving the CDN time to propagate
 * before declaring a genuine mismatch.
 */
const FEED_CHECK_IDS = new Set(["feed-version", "feed-source-commit", "feed-build-number"]);
const FEED_POLL_MAX_ATTEMPTS = 20; // ~20 × 15s ≈ 5 minutes total.
const FEED_POLL_INTERVAL_MS = 15_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function sh(cmd: string, args: string[], fallback: string | null = null): string | null {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return fallback;
  }
}

async function fetchFeed(): Promise<{ version: string | null; sourceCommit: string | null; buildNumber: number | null }> {
  try {
    // Cache-bust exactly as feed-check.ts does — the beta feed asset is
    // CLOBBERED in place on a fixed URL, so a cached copy is the likeliest
    // reason a just-published feed looks stale.
    const res = await fetch(`${FEED_URL}?t=${Date.now()}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
    if (res.ok) {
      const feed = await res.json() as { version?: string; sourceCommit?: string; buildNumber?: number };
      return {
        version: typeof feed.version === "string" ? feed.version : null,
        sourceCommit: typeof feed.sourceCommit === "string" ? feed.sourceCommit : null,
        buildNumber: Number.isInteger(feed.buildNumber) ? feed.buildNumber ?? null : null,
      };
    }
  } catch {
    // A missing/unreachable feed surfaces as failing feed checks below.
  }
  return { version: null, sourceCommit: null, buildNumber: null };
}

/** True when the proof's only failures are feed checks — i.e. plausibly CDN lag, worth waiting on. */
function onlyFeedChecksFailing(proof: AutoUpdateProof): boolean {
  const failing = proof.checks.filter((c) => !c.ok);
  return failing.length > 0 && failing.every((c) => FEED_CHECK_IDS.has(c.id));
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

  // Local/API inputs above are immediate and correct; only the feed lags behind
  // GitHub's CDN, so re-fetch it on each polling attempt while everything else
  // stays fixed.
  const evaluate = (feed: { version: string | null; sourceCommit: string | null; buildNumber: number | null }): AutoUpdateProof =>
    evaluateAutoUpdateProof({
      headCommit,
      packageVersion: pkg.version ?? "",
      tauriVersion: version,
      sourceVersion: src.version,
      buildNumber: src.buildNumber,
      tagName,
      tagCommit,
      releaseExists,
      feedVersion: feed.version,
      feedSourceCommit: feed.sourceCommit,
      feedBuildNumber: feed.buildNumber,
    });

  let proof = evaluate(await fetchFeed());

  // Poll only when the sole failures are feed checks (CDN propagation lag).
  // Any other failure is a genuine config error that retrying won't fix, so we
  // fall straight through to the report and exit.
  for (let attempt = 1; attempt <= FEED_POLL_MAX_ATTEMPTS && onlyFeedChecksFailing(proof); attempt++) {
    console.log(
      `… feed not yet propagated; waiting for GitHub CDN to catch up ` +
        `(attempt ${attempt}/${FEED_POLL_MAX_ATTEMPTS}, retrying in ${FEED_POLL_INTERVAL_MS / 1000}s)…`,
    );
    await sleep(FEED_POLL_INTERVAL_MS);
    proof = evaluate(await fetchFeed());
  }

  console.log(`HiveMatrix auto-update release proof for ${tagName} (${CHANNEL} channel — ${FEED_URL})`);
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
